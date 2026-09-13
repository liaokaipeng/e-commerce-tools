'use strict';
/**
 * 批量刷新执行体（SSE 流式事件）。
 *
 * 与「开放平台」页单个「刷新 token」按钮共用同一条刷新入口（client/ensure.refreshShopNow）与同一套
 * 分组决策（client/plan.planRefresh），本模块只负责「把全部店铺按组编排成一次批量刷新」。
 *
 * 为什么必须按组刷新、不能逐店遍历：
 * 主账号授权得到的是账号级 token 对，同一 merchant 下的店铺共享同一个 refresh_token，而官方语义是
 * 「旧 refresh_token 调用一次即作废」。逐店刷新时，第一店刷完就轮换了 token 对，后续店铺拿旧 token
 * 必然失败，并会把整组店铺标记成「需重新授权」（官方 FAQ138 Q8）。因此批量刷新 = 先按 refreshToken
 * 归组（planRefreshGroups），每组只调一次 refreshShopNow —— 共享组由 planRefresh 走 merchant_id 整组续期，
 * 独立凭证只写回本店。
 *
 * 刷不了的组（整组已失效 / 共享 token 缺 merchant_id）直接跳过并说明原因，不发网关请求、不额外标失效：
 * 用户主动点批量刷新不该把「其实还好的店铺」标死，跳过原因交给前端展示。
 *
 * 另有两道防护（见 openapi 链路文档 §3）：
 * - 单飞互斥（runningJobId）：同一时刻只允许一个批量任务，进行中再触发回 409，防并发批量轮换同一批 token；
 * - 冷却：refreshShopNow 自带冷却，刚刷过的组直接复用当前 token（mode='cooldown'），不重复触网。
 */
const { sendJson } = require('../../lib/http-utils');
// 长任务注册中心：暂停 / 继续 / 取消 / SSE 断开即取消 / 僵尸清理；批量骨架统一走 runShopBatch
const jobs = require('../../lib/jobs');
const { notifyMonitorAuthChanged } = require('../notify');
const { refreshShopNow } = require('../client/ensure');
const { planRefreshGroups } = require('./plan');
const { summaryText } = require('./text');

// 单飞互斥：同一时刻只允许一个批量刷新任务在跑。
// 并发批量（连点按钮 / 多标签页 / 刷新页面后重复触发）会各自持有一份「按当前 refresh_token 归组」的过期计划，
// 两组轮换同一批 refresh_token，第二轮必然撞上已作废的凭证 → 网关拒绝 → 整组被判「需重新授权」。
// 存 jobId 而非布尔：校验时顺带确认任务仍在注册表（被 TTL 回收的陈旧标记自动放行，避免永久锁死）。
let runningJobId = null;

/**
 * 批量刷新执行体（SSE 流式事件）。
 * 事件：start（jobId/总店铺数/总组数）→ 逐个 skipped（刷不了的组）/ group-start / group-done → summary 或 cancelled。
 * 组间经 jobs.checkpoint 门控：SSE 断开（用户关页面）或前端调 /cancel 即停止后续组。
 * 进行中的那一组会自然跑完（刷新请求本身不支持中断），不影响正确性。
 * 单飞：已有任务在跑时直接 409，不启动第二个（见 runningJobId）。
 * 批量骨架（SSE 建立 / 断开即取消 / 逐组 checkpoint / CancelledError 归并 / 收尾）统一走 lib/jobs.runShopBatch。
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

  let refreshed = 0; // 成功组数
  let synced = 0;    // 实际续期店铺数（共享组一次刷多店）
  let failed = 0;
  let cooled = 0;    // 冷却期内被跳过重复刷新的组数（刚刷过且 token 仍有效）
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
    // 循环前先把「刷不了的组」逐条下发，交给前端展示跳过原因
    beforeLoop: (ctx) => {
      for (const s of plan.skipped) {
        ctx.emit({ type: 'skipped', shopIds: s.shopIds, size: s.size, msg: s.reason });
      }
    },
    onUnit: async (g, ctx) => {
      ctx.emit({ type: 'group-start', shopId: g.repShopId, shopIds: g.shopIds, size: g.size, mode: g.mode });
      try {
        // 组代表进刷新入口：共享 token 组由 planRefresh 走 merchant_id 整组续期并全组写回
        const r = await refreshShopNow(app.env, g.repShopId);
        refreshed += 1;
        synced += r.synced || 0;
        if (r.mode === 'cooldown') cooled += 1; // 冷却期内复用当前 token，未发网关请求
        ctx.emit({
          type: 'group-done',
          shopId: g.repShopId,
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
          shopId: g.repShopId,
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
          msg: `已取消批量刷新：已完成 ${refreshed} 组（${synced} 个店铺），剩余未处理`,
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
