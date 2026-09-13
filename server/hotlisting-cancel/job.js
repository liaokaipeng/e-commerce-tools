'use strict';
// 执行取消注册（SSE 流式事件）：逐店逐 SPU 拉最新已注册列表 → 逐 SKU 取消注册，支持暂停/继续/取消。
const { sendJson, sse } = require('../lib/http-utils');
const jobs = require('../lib/jobs');
const { sleep, loadCookie, loadStoreNames, storeNameOf } = require('../lib/shopee-session');
const { CANCEL_DELAY_MS } = require('./constants');
const { loadSpuConfig } = require('./config');
const { resolvePerShopSpus } = require('./parse');
const { regionOf, fetchEnrolledSkus, unenrollSku } = require('./api');

/** 监听响应连接关闭（SSE 客户端断开兜底；已结束时不重复触发） */
function reqOnClose(res, fn) {
  if (typeof res.on !== 'function') return;
  res.on('close', fn);
}

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
  const emit = sse(res);
  // SSE 客户端断开（用户关掉页面）即视为取消：任务在下个门控点退出，不再空跑。
  let clientGone = false;
  reqOnClose(res, () => { clientGone = true; });
  const jobId = jobs.create();

  (async () => {
    const storeNames = loadStoreNames();
    let cookie;
    try {
      cookie = loadCookie();
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
        const plan = perShop[String(id)] || { error: '未配置 SPU ID' };
        emit({ type: 'shop-start', shopId: String(id), name });
        if (plan.error) {
          emit({ type: 'shop-done', shopId: String(id), name, ok: false, cancelled: 0, failed: 0, msg: plan.error });
          results.push({ shopId: String(id), name, ok: false, cancelled: 0, failed: 0 });
          continue;
        }
        let cancelled = 0;
        let failed = 0;
        try {
          const region = await regionOf(cookie, String(id));
          for (const spuId of plan.spus) {
            await jobs.checkpoint(jobId, () => clientGone);
            // 实时拉取最新已注册列表（预览后状态可能已变化）
            let rows;
            try {
              rows = await fetchEnrolledSkus(cookie, String(id), region, spuId);
            } catch (e) {
              failed += 1;
              emit({ type: 'spu-done', shopId: String(id), spuId, ok: false, msg: e.message });
              continue;
            }
            if (rows.length === 0) {
              emit({ type: 'spu-done', shopId: String(id), spuId, ok: true, cancelled: 0, msg: '无已注册 SKU' });
              continue;
            }
            for (const r of rows) {
              await jobs.checkpoint(jobId, () => clientGone);
              emit({
                type: 'sku-start',
                shopId: String(id),
                spuId,
                itemName: r.itemName,
                modelName: r.modelName,
              });
              try {
                await unenrollSku(cookie, String(id), region, r.rskuId, r.vskuId);
                cancelled += 1;
                emit({ type: 'sku-done', shopId: String(id), spuId, itemName: r.itemName, ok: true });
              } catch (e) {
                failed += 1;
                emit({ type: 'sku-done', shopId: String(id), spuId, itemName: r.itemName, ok: false, msg: e.message });
              }
              await sleep(CANCEL_DELAY_MS);
            }
            emit({ type: 'spu-done', shopId: String(id), spuId, ok: true, cancelled: rows.length });
          }
          emit({ type: 'shop-done', shopId: String(id), name, ok: true, cancelled, failed, msg: '' });
          results.push({ shopId: String(id), name, ok: true, cancelled, failed });
        } catch (e) {
          emit({ type: 'shop-done', shopId: String(id), name, ok: false, cancelled: 0, failed: 0, msg: e.message });
          results.push({ shopId: String(id), name, ok: false, cancelled: 0, failed: 0, msg: e.message });
        }
      }
    } catch (e) {
      // 取消（用户点取消 / SSE 断开）走这里：已处理的部分照常汇总，不再继续后续店铺
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
    try { emit({ type: 'fatal', msg: `取消注册失败：${e.message}` }); res.end(); } catch { /* ignore */ }
  });
}

module.exports = { handleRun };
