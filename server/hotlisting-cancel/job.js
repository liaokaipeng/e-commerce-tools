'use strict';
// 执行取消注册（SSE 流式事件）：逐店逐 SPU 拉最新已注册列表 → 逐 SKU 取消注册，支持暂停/继续/取消。
// 批量骨架（SSE 建立 / 断开即取消 / 逐店 checkpoint / CancelledError 归并 / 收尾）统一走 lib/jobs.runShopBatch。
const { sendJson } = require('../lib/http-utils');
const jobs = require('../lib/jobs');
const { sleep, loadCookie, loadStoreNames, storeNameOf } = require('../lib/shopee-session');
const { CANCEL_DELAY_MS } = require('./constants');
const { loadSpuConfig } = require('./config');
const { resolvePerShopSpus } = require('./parse');
const { regionOf, fetchEnrolledSkus, unenrollSku } = require('./api');

function handleRun(body, res) {
  const shopIds = Array.isArray(body.shopIds) ? body.shopIds : [];
  if (shopIds.length === 0) {
    sendJson(res, 400, { ok: false, msg: '请先选择至少一个店铺' });
    return;
  }
  const { perShop } = resolvePerShopSpus(shopIds, body.spuMap, loadSpuConfig());
  if (Object.values(perShop).every(p => p.error)) {
    sendJson(res, 400, { ok: false, msg: '所选店铺均未配置有效的 SPU ID' });
    return;
  }

  const results = [];
  jobs.runShopBatch({
    res,
    units: shopIds,
    // 执行前准备：店铺名映射 + 登录 Cookie；缺失时执行器发 fatal 并结束（不下发 jobId）
    prepare: () => ({ storeNames: loadStoreNames(), cookie: loadCookie() }),
    onUnit: async (id, ctx) => {
      const { storeNames, cookie } = ctx;
      const name = storeNameOf(id, storeNames);
      const plan = perShop[String(id)] || { error: '未配置 SPU ID' };
      ctx.emit({ type: 'shop-start', shopId: String(id), name });
      if (plan.error) {
        ctx.emit({ type: 'shop-done', shopId: String(id), name, ok: false, cancelled: 0, failed: 0, msg: plan.error });
        results.push({ shopId: String(id), name, ok: false, cancelled: 0, failed: 0 });
        return;
      }
      let cancelled = 0;
      let failed = 0;
      try {
        const region = await regionOf(cookie, String(id));
        for (const spuId of plan.spus) {
          await ctx.checkpoint();
          // 实时拉取最新已注册列表（预览后状态可能已变化）
          let rows;
          try {
            rows = await fetchEnrolledSkus(cookie, String(id), region, spuId);
          } catch (e) {
            failed += 1;
            ctx.emit({ type: 'spu-done', shopId: String(id), spuId, ok: false, msg: e.message });
            continue;
          }
          if (rows.length === 0) {
            ctx.emit({ type: 'spu-done', shopId: String(id), spuId, ok: true, cancelled: 0, msg: '无已注册 SKU' });
            continue;
          }
          for (const r of rows) {
            await ctx.checkpoint();
            ctx.emit({
              type: 'sku-start',
              shopId: String(id),
              spuId,
              itemName: r.itemName,
              modelName: r.modelName,
            });
            try {
              await unenrollSku(cookie, String(id), region, r.rskuId, r.vskuId);
              cancelled += 1;
              ctx.emit({ type: 'sku-done', shopId: String(id), spuId, itemName: r.itemName, ok: true });
            } catch (e) {
              failed += 1;
              ctx.emit({ type: 'sku-done', shopId: String(id), spuId, itemName: r.itemName, ok: false, msg: e.message });
            }
            await sleep(CANCEL_DELAY_MS);
          }
          ctx.emit({ type: 'spu-done', shopId: String(id), spuId, ok: true, cancelled: rows.length });
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
    fatalPrefix: '取消注册失败：',
  });
}

module.exports = { handleRun };
