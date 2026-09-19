'use strict';
/**
 * 批量刷新执行体（SSE 流式事件）。
 *
 * 与「开放平台」页单个「刷新 token」按钮共用同一条刷新入口（client/ensure.refreshShopNow），
 * 本模块只负责「把全部店铺逐个刷一遍」。
 *
 * 为什么逐店刷新是对的：官方 refresh_access_token 要求 shop_id / merchant_id「必须分别刷新」，
 * 且按 shop_id 刷新得到的 token 只绑定该店（详见 docs/开放平台链路.md §3）。因此批量刷新 = 逐店调用
 * refreshShopNow，每个店铺各自换 token、各自保存。曾经的「按 refresh_token 归组、用 merchant_id 整组续期」
 * 已被生产实测证伪：merchant_id 刷出来的是**商户级 token**，拿它调店铺级接口一律报 invalid_acceess_token。
 *
 * 刷不了的店铺（已失效 / 缺 refresh_token）直接跳过并说明原因，不发网关请求、不额外标失效：
 * 用户主动点批量刷新不该把「其实还好的店铺」标死，跳过原因交给前端展示。
 *
 * 另有两道防护（见 openapi 链路文档 §3）：
 * - 单飞互斥（runningJobId）：同一时刻只允许一个批量任务，进行中再触发回 409；
 * - 冷却：refreshShopNow 自带冷却，刚刷过的店铺直接复用当前 token（mode='cooldown'），不重复触网。
 */
const { sendJson } = require('../../lib/http-utils');
// 长任务注册中心：暂停 / 继续 / 取消 / SSE 断开即取消 / 僵尸清理；批量骨架统一走 runShopBatch
const jobs = require('../../lib/jobs');
const { notifyMonitorAuthChanged } = require('../notify');
const { refreshShopNow } = require('../client/ensure');
const { planRefreshGroups } = require('./plan');
const { summaryText } = require('./text');

// 单飞互斥：同一时刻只允许一个批量刷新任务在跑。
// 并发批量（连点按钮 / 多标签页 / 刷新页面后重复触发）会各自持有一份过期计划并轮换同一批凭证。
// 存 jobId 而非布尔：校验时顺带确认任务仍在注册表（被 TTL 回收的陈旧标记自动放行，避免永久锁死）。
let runningJobId = null;

/**
 * 批量刷新执行体（SSE 流式事件）。
 * 事件：start（jobId/总店铺数/总单元数）→ 逐个 skipped / group-start / group-done → summary 或 cancelled。
 * 组间经 jobs.checkpoint 门控：SSE 断开（用户关页面）或前端调 /cancel 即停止后续店铺。
 * 进行中的那一店会自然跑完（刷新请求本身不支持中断），不影响正确性。
 * 单飞：已有任务在跑时直接 409，不启动第二个（见 runningJobId）。
 * 批量骨架（SSE 建立 / 断开即取消 / 逐单元 checkpoint / CancelledError 归并 / 收尾）统一走 lib/jobs.runShopBatch。
 */
function handleRefreshAll(res) {
  const store = require('../store'); // 延迟 require：测试按缓存清理隔离凭证实例
  // 单飞互斥：任务仍在注册表中才是真的在跑；陈旧标记（已被 TTL 回收）放行
  if (runningJobId) {
    if (jobs.has(runningJobId)) {
      sendJson(res, 409, { ok: false, msg: '已有批量刷新任务正在进行，请等它结束或先点「取消」再试' });
      return;
    }
    runningJobId = null;
  }
  const app = store.getApp();
  if (!app) {
    sendJson(res, 400, { ok: false, msg: '尚未配置 App，请先保存 partner_id / partner_key' });
    return;
  }
  const shops = store.getShopsRaw(app.env);
  if (!shops.length) {
    sendJson(res, 400, { ok: false, msg: '当前环境没有已授权店铺，请先完成店铺授权' });
    return;
  }
  const plan = planRefreshGroups(shops);
  if (!plan.groups.length && !plan.skipped.length) {
    sendJson(res, 400, { ok: false, msg: '没有可刷新的店铺' });
    return;
  }

  let refreshed = 0; // 成功店铺数
  let synced = 0;    // 实际续期店铺数（逐店刷新时与 refreshed 相等）
  let failed = 0;
  let cooled = 0;    // 冷却期内被跳过重复刷新的店铺数（刚刷过且 token 仍有效）
  const failedItems = [];

  jobs.runShopBatch({
    res,
    units: plan.groups,
    startPayload: {
      totalShops: shops.length,
      totalGroups: plan.groups.length,
      skipped: plan.skipped,
    },
    // 建任务即登记单飞互斥；收尾（正常 / 取消 / 异常）必须释放，否则批量刷新被永久锁死
    onCreate: (jobId) => { runningJobId = jobId; },
    release: (jobId) => { jobs.finish(jobId); if (runningJobId === jobId) runningJobId = null; },
    // 循环前先把「刷不了的店铺」逐条下发，交给前端展示跳过原因
    beforeLoop: (ctx) => {
      for (const s of plan.skipped) {
        ctx.emit({ type: 'skipped', shopIds: s.shopIds, size: s.size, msg: s.reason });
      }
    },
    onUnit: async (g, ctx) => {
      const shopId = g.repShopId;
      ctx.emit({ type: 'group-start', shopId, shopIds: g.shopIds, size: g.size, mode: g.mode });
      try {
        // 逐店刷新：每个店铺用各自 shop_id 换 token、各自保存
        const r = await refreshShopNow(app.env, shopId);
        refreshed += 1;
        synced += r.synced || 0;
        if (r.mode === 'cooldown') cooled += 1; // 冷却期内复用当前 token，未发网关请求
        ctx.emit({
          type: 'group-done',
          shopId,
          shopIds: g.shopIds,
          size: g.size,
          mode: r.mode,
          ok: true,
          synced: r.synced || 0,
        });
      } catch (e) {
        failed += 1;
        failedItems.push({ shopIds: g.shopIds, msg: e.message });
        ctx.emit({
          type: 'group-done',
          shopId,
          shopIds: g.shopIds,
          size: g.size,
          mode: g.mode,
          ok: false,
          msg: e.message,
        });
      }
    },
    finalEvent: ({ cancelledByUser }) => {
      const skippedShops = plan.skipped.reduce((n, s) => n + s.size, 0);
      if (cancelledByUser) {
        return {
          type: 'cancelled',
          refreshed,
          synced,
          failed,
          cooled,
          skipped: skippedShops,
          msg: `已取消批量刷新：已完成 ${refreshed} 个店铺，剩余未处理`,
        };
      }
      if (refreshed > 0) notifyMonitorAuthChanged(); // 刷新成功即恢复采集，通知大屏立即重取店铺列表
      return {
        type: 'summary',
        totalShops: shops.length,
        refreshed,
        synced,
        failed,
        cooled,
        skipped: skippedShops,
        failedItems,
        msg: summaryText({ refreshed, synced, failed, skippedShops, cooled }),
      };
    },
    fatalPrefix: '批量刷新失败：',
  });
}

module.exports = { handleRefreshAll };
