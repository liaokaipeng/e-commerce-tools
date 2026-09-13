'use strict';
// 执行撤销（SSE 流式事件）：逐店实时拉取待改进列表 → 逐条撤销，支持暂停/继续/取消。
const { sendJson, sse } = require('../lib/http-utils');
const jobs = require('../lib/jobs');
const {
  DEFAULT_REGION, sleep, loadCookieHeader, loadStoreNames, storeNameOf, fetchShopRegion,
} = require('../lib/shopee-session');
const { WITHDRAW_DELAY_MS } = require('./constants');
const { fetchImprovementBids, withdrawBid } = require('./api');

function handleRun(body, res) {
  const shopIds = Array.isArray(body.shopIds) ? body.shopIds : [];
  if (shopIds.length === 0) {
    sendJson(res, 400, { ok: false, msg: '请先选择至少一个店铺' });
    return;
  }
  const emit = sse(res);
  // SSE 客户端断开（用户关掉页面）即视为取消，任务在下个门控点退出
  let clientGone = false;
  if (typeof res.on === 'function') res.on('close', () => { clientGone = true; });
  const jobId = jobs.create();

  (async () => {
    const storeNames = loadStoreNames();
    let cookieHeader;
    try {
      cookieHeader = loadCookieHeader();
    } catch (e) {
      jobs.finish(jobId);
      emit({ type: 'fatal', msg: e.message });
      res.end();
      return;
    }
    // 先下发 jobId，前端据此发暂停 / 继续 / 取消指令
    emit({ type: 'start', jobId });

    const results = [];
    let cancelledByUser = false;
    try {
      for (const id of shopIds) {
        await jobs.checkpoint(jobId, () => clientGone);
        const name = storeNameOf(id, storeNames);
        emit({ type: 'shop-start', shopId: String(id), name });
        try {
          const region = (await fetchShopRegion(cookieHeader, String(id))) || DEFAULT_REGION;
          // 实时拉取最新待改进列表（预览后状态可能已变化）
          const rows = await fetchImprovementBids(cookieHeader, String(id), region);
          let cancelled = 0;
          let failed = 0;
          for (const r of rows) {
            await jobs.checkpoint(jobId, () => clientGone);
            emit({
              type: 'bid-start',
              shopId: String(id),
              itemName: r.itemName,
              modelName: r.modelName,
              bidId: r.bidId,
            });
            try {
              await withdrawBid(cookieHeader, String(id), region, r.bidId);
              cancelled += 1;
              emit({ type: 'bid-done', shopId: String(id), bidId: r.bidId, itemName: r.itemName, ok: true });
            } catch (e) {
              failed += 1;
              emit({ type: 'bid-done', shopId: String(id), bidId: r.bidId, itemName: r.itemName, ok: false, msg: e.message });
            }
            await sleep(WITHDRAW_DELAY_MS);
          }
          emit({ type: 'shop-done', shopId: String(id), name, ok: true, cancelled, failed, msg: '' });
          results.push({ shopId: String(id), name, ok: true, cancelled, failed });
        } catch (e) {
          emit({ type: 'shop-done', shopId: String(id), name, ok: false, cancelled: 0, failed: 0, msg: e.message });
          results.push({ shopId: String(id), name, ok: false, cancelled: 0, failed: 0, msg: e.message });
        }
      }
    } catch (e) {
      if (!(e instanceof jobs.CancelledError)) throw e;
      cancelledByUser = true;
    }

    jobs.finish(jobId);
    emit({
      type: cancelledByUser ? 'cancelled' : 'summary',
      cancelled: results.reduce((n, r) => n + (r.cancelled || 0), 0),
      failed: results.reduce((n, r) => n + (r.failed || 0), 0),
      success: results.filter(r => r.ok).length,
      total: results.length,
    });
    try { res.end(); } catch { /* ignore */ }
  })().catch((e) => {
    jobs.finish(jobId);
    try { emit({ type: 'fatal', msg: `撤销失败：${e.message}` }); res.end(); } catch { /* ignore */ }
  });
}

module.exports = { handleRun };
