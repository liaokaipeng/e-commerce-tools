'use strict';
/**
 * 开放平台「批量刷新 token」（CommonJS）
 *
 * 与「开放平台」页单个「刷新 token」按钮共用同一条刷新入口（client.refreshShopNow）与同一套
 * 分组决策（client.planRefresh），本模块只负责「把全部店铺按组编排成一次批量刷新」。
 *
 * 为什么必须按组刷新、不能逐店遍历：
 * 主账号授权得到的是账号级 token 对，同一 merchant 下的店铺共享同一个 refresh_token，而官方语义是
 * 「旧 refresh_token 调用一次即作废」。逐店刷新时，第一店刷完就轮换了 token 对，后续店铺拿旧 token
 * 必然失败，并会把整组店铺标记成「需重新授权」（官方 FAQ138 Q8）。因此批量刷新 = 先按 refreshToken
 * 归组，每组只调一次 refreshShopNow —— 共享组由 planRefresh 走 merchant_id 整组续期，独立凭证只写回本店。
 *
 * 刷不了的组（整组已失效 / 共享 token 缺 merchant_id）直接跳过并说明原因，不发网关请求、不额外标失效：
 * 用户主动点批量刷新不该把「其实还好的店铺」标死，跳过原因交给前端展示。
 */
const { sendJson, sse, readRouteBody } = require('../lib/http-utils');
// 长任务注册中心：暂停 / 继续 / 取消 / SSE 断开即取消 / 僵尸清理
const jobs = require('../lib/jobs');
const store = require('./store');
const client = require('./client');

/** 授权状态变化后通知监控大屏立即刷新店铺列表（与单店刷新后同一行为，见 openapi.js） */
function notifyMonitorAuthChanged() {
  try {
    require('../monitor/scheduler').notifyAuthChanged();
  } catch { /* 监控模块未加载时忽略 */ }
}

/**
 * 批量刷新计划（纯函数，单测覆盖）：
 * - 按 refreshToken 归组：同组即共享 token 对，**只能刷一次**；
 * - 组内优先用「未失效」店铺当代表（失效店铺自身刷不了，但整组续期成功后会被一并恢复）；
 * - 整组都失效 / 缺 refresh_token / 共享但无 merchant_id 无法整组续期 → 跳过并给出原因。
 * @param {Array<{shopId, refreshToken, merchantId, invalid}>} shops 同环境全部店铺凭证
 * @param {(shop: object, all: Array) => {mode: string}} [planOf] 分组决策函数（默认 client.planRefresh，便于单测注入）
 * @returns {{groups: Array<{repShopId, shopIds, size, mode}>, skipped: Array<{shopIds, size, reason}>}}
 */
function planRefreshGroups(shops, planOf = client.planRefresh) {
  const list = Array.isArray(shops) ? shops.slice() : [];
  const byId = (a, b) => String(a).localeCompare(String(b), undefined, { numeric: true });
  const byToken = new Map();
  for (const s of list) {
    if (!s || s.shopId === undefined || s.shopId === null) continue;
    const key = String(s.refreshToken || '');
    if (!byToken.has(key)) byToken.set(key, []);
    byToken.get(key).push(s);
  }

  const groups = [];
  const skipped = [];
  for (const [token, group] of byToken) {
    const shopIds = group.map((s) => String(s.shopId)).sort(byId);
    if (!token) {
      skipped.push({ shopIds, size: shopIds.length, reason: '缺少 refresh_token，需重新授权' });
      continue;
    }
    const active = group.filter((s) => !s.invalid);
    if (!active.length) {
      skipped.push({ shopIds, size: shopIds.length, reason: '授权已失效，需重新授权' });
      continue;
    }
    const rep = active.slice().sort((a, b) => byId(a.shopId, b.shopId))[0];
    const mode = planOf(rep, list).mode;
    if (mode === 'group-nomerchant') {
      skipped.push({ shopIds, size: shopIds.length, reason: '共享 token 缺少 merchant_id，无法整组续期，需重新授权' });
      continue;
    }
    groups.push({ repShopId: String(rep.shopId), shopIds, size: shopIds.length, mode });
  }

  // 输出顺序稳定（便于展示与测试）：按组代表店铺 ID 排序
  groups.sort((a, b) => byId(a.repShopId, b.repShopId));
  skipped.sort((a, b) => byId(a.shopIds[0], b.shopIds[0]));
  return { groups, skipped };
}

/** 汇总文案（中文，前端直接展示） */
function summaryText({ refreshed, synced, failed, skippedShops }) {
  const parts = [`批量刷新完成：成功 ${refreshed} 组（${synced} 个店铺 token 已续期）`];
  if (failed) parts.push(`失败 ${failed} 组`);
  if (skippedShops) parts.push(`跳过 ${skippedShops} 个店铺（需重新授权，见列表状态）`);
  return parts.join('，');
}

/**
 * 批量刷新执行体（SSE 流式事件）。
 * 事件：start（jobId/总店铺数/总组数）→ 逐个 skipped（刷不了的组）/ group-start / group-done → summary 或 cancelled。
 * 组间经 jobs.checkpoint 门控：SSE 断开（用户关页面）或前端调 /cancel 即停止后续组。
 * 进行中的那一组会自然跑完（刷新请求本身不支持中断），不影响正确性。
 */
function handleRefreshAll(res) {
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

  const emit = sse(res);
  // SSE 客户端断开（用户关掉页面）即视为取消，任务在下个门控点退出
  let clientGone = false;
  if (typeof res.on === 'function') res.on('close', () => { clientGone = true; });
  const jobId = jobs.create();

  (async () => {
    emit({
      type: 'start',
      jobId,
      totalShops: shops.length,
      totalGroups: plan.groups.length,
      skipped: plan.skipped,
    });

    let refreshed = 0; // 成功组数
    let synced = 0;    // 实际续期店铺数（共享组一次刷多店）
    let failed = 0;
    const failedItems = [];
    let cancelledByUser = false;

    try {
      for (const s of plan.skipped) {
        emit({ type: 'skipped', shopIds: s.shopIds, size: s.size, msg: s.reason });
      }
      for (const g of plan.groups) {
        await jobs.checkpoint(jobId, () => clientGone);
        emit({ type: 'group-start', shopId: g.repShopId, shopIds: g.shopIds, size: g.size, mode: g.mode });
        try {
          // 组代表进刷新入口：共享 token 组由 planRefresh 走 merchant_id 整组续期并全组写回
          const r = await client.refreshShopNow(app.env, g.repShopId);
          refreshed += 1;
          synced += r.synced || 0;
          emit({
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
          emit({
            type: 'group-done',
            shopId: g.repShopId,
            shopIds: g.shopIds,
            size: g.size,
            mode: g.mode,
            ok: false,
            msg: e.message,
          });
        }
      }
    } catch (e) {
      if (!(e instanceof jobs.CancelledError)) throw e;
      cancelledByUser = true;
    }

    jobs.finish(jobId);
    const skippedShops = plan.skipped.reduce((n, s) => n + s.size, 0);
    if (cancelledByUser) {
      emit({
        type: 'cancelled',
        refreshed,
        synced,
        failed,
        skipped: skippedShops,
        msg: `已取消批量刷新：已完成 ${refreshed} 组（${synced} 个店铺），剩余未处理`,
      });
    } else {
      if (refreshed > 0) notifyMonitorAuthChanged(); // 刷新成功即恢复采集，通知大屏立即重取店铺列表
      emit({
        type: 'summary',
        totalShops: shops.length,
        refreshed,
        synced,
        failed,
        skipped: skippedShops,
        failedItems,
        msg: summaryText({ refreshed, synced, failed, skippedShops }),
      });
    }
    try { res.end(); } catch { /* 连接已断开，忽略 */ }
  })().catch((e) => {
    jobs.finish(jobId);
    try { emit({ type: 'fatal', msg: `批量刷新失败：${e.message}` }); res.end(); } catch { /* ignore */ }
  });
}

// ============ 路由注册 ============
function register({ post }) {
  // 批量刷新（SSE）：body 可为空对象，店铺范围由服务端按当前环境全部已授权店铺决定
  post('/api/openapi/refresh-all/run', async (req, res) => {
    // 读取（消费）请求体即可：批量范围由服务端决定，body 无业务参数
    await readRouteBody(req, '/api/openapi/refresh-all/run');
    handleRefreshAll(res);
  });

  // 暂停 / 继续 / 取消执行中的批量刷新（body { jobId }，jobId 由 run 的 start 事件下发）
  jobs.registerControlRoutes(post, '/api/openapi/refresh-all');
}

module.exports = {
  register,
  // 纯函数（单测覆盖）
  planRefreshGroups,
  _test: { planRefreshGroups, summaryText },
};
