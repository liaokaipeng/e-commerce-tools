'use strict';
// 执行撤销（SSE 流式事件）：逐店实时拉取待改进列表 → 逐条撤销，支持暂停/继续/取消。
// 批量骨架（SSE 建立 / 断开即取消 / 逐店 checkpoint / CancelledError 归并 / 收尾）统一走 lib/jobs.runShopBatch。
const { sendJson } = require('../lib/http-utils');
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

  const results = [];
  jobs.runShopBatch({
    res,
    units: shopIds,
    // 执行前准备：店铺名映射 + 登录 Cookie；缺失时执行器发 fatal 并结束（不下发 jobId）
    prepare: () => ({ storeNames: loadStoreNames(), cookieHeader: loadCookieHeader() }),
    onUnit: async (id, ctx) => {
      const { storeNames, cookieHeader } = ctx;
      const name = storeNameOf(id, storeNames);
      ctx.emit({ type: 'shop-start', shopId: String(id), name });
      try {
        const region = (await fetchShopRegion(cookieHeader, String(id))) || DEFAULT_REGION;
        // 实时拉取最新待改进列表（预览后状态可能已变化）
        const rows = await fetchImprovementBids(cookieHeader, String(id), region);
        let cancelled = 0;
        let failed = 0;
        for (const r of rows) {
          await ctx.checkpoint();
          ctx.emit({
            type: 'bid-start',
            shopId: String(id),
            itemName: r.itemName,
            modelName: r.modelName,
            bidId: r.bidId,
          });
          try {
            await withdrawBid(cookieHeader, String(id), region, r.bidId);
            cancelled += 1;
            ctx.emit({ type: 'bid-done', shopId: String(id), bidId: r.bidId, itemName: r.itemName, ok: true });
          } catch (e) {
            failed += 1;
            ctx.emit({ type: 'bid-done', shopId: String(id), bidId: r.bidId, itemName: r.itemName, ok: false, msg: e.message });
          }
          await sleep(WITHDRAW_DELAY_MS);
        }
        ctx.emit({ type: 'shop-done', shopId: String(id), name, ok: true, cancelled, failed, msg: '' });
        results.push({ shopId: String(id), name, ok: true, cancelled, failed });
      } catch (e) {
        ctx.emit({ type: 'shop-done', shopId: String(id), name, ok: false, cancelled: 0, failed: 0, msg: e.message });
        results.push({ shopId: String(id), name, ok: false, cancelled: 0, failed: 0, msg: e.message });
      }
    },
    finalEvent: ({ cancelledByUser }) => ({
      type: cancelledByUser ? 'cancelled' : 'summary',
      cancelled: results.reduce((n, r) => n + (r.cancelled || 0), 0),
      failed: results.reduce((n, r) => n + (r.failed || 0), 0),
      success: results.filter(r => r.ok).length,
      total: results.length,
    }),
    fatalPrefix: '撤销失败：',
  });
}

module.exports = { handleRun };
