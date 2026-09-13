'use strict';
// 竞价导出编排：单店导出（抓取 → 落盘）与 SSE 流式批量导出。
const path = require('path');
const { sendJson, sse } = require('../lib/http-utils');
const {
  DEFAULT_REGION, loadCookieHeader, loadStoreNames, storeNameOf, fetchShopRegion,
} = require('../lib/shopee-session');
const { ensureDir, timestampText } = require('../lib/export-utils');
const { fetchWinningData } = require('./api');
const { writeExcel } = require('./excel');

/** 导出单个店铺，返回结果对象 */
async function exportShop(shopId, saveDir) {
  const cookieHeader = loadCookieHeader();

  // 1. 获取店铺市场（cbsc_shop_region），取不到按 DEFAULT_REGION 继续导出
  const region = (await fetchShopRegion(cookieHeader, shopId)) || DEFAULT_REGION;

  // 2. 拉取【获胜】数据
  const { rows, total } = await fetchWinningData(cookieHeader, shopId, region);

  // 3. 导出 Excel（保存到用户指定目录，缺省为系统下载目录；文件名带时分秒避免冲突）
  const outDir = ensureDir(saveDir);
  const out = path.join(outDir, `竞价获胜_店铺${shopId}_${timestampText()}.xlsx`);
  await writeExcel(rows, out);

  return { rows: rows.length, total, file: path.basename(out) };
}

// ============ 导出接口（SSE 流式事件） ============
function handleExport(body, res) {
  const shopIds = Array.isArray(body.shopIds) ? body.shopIds : [];
  const saveDir = String(body.dir || '').trim();
  if (shopIds.length === 0) {
    sendJson(res, 400, { ok: false, msg: '请先选择至少一个店铺' });
    return;
  }
  const emit = sse(res);

  (async () => {
    const results = [];
    const storeNames = loadStoreNames();
    for (const id of shopIds) {
      const name = storeNameOf(id, storeNames);
      emit({ type: 'start', shopId: id, name });
      try {
        const r = await exportShop(String(id), saveDir);
        emit({ type: 'done', shopId: id, name, ok: true, rows: r.rows, total: r.total, file: r.file });
        results.push({ shopId: id, name, ok: true, rows: r.rows, file: r.file });
      } catch (e) {
        emit({ type: 'done', shopId: id, name, ok: false, msg: e.message });
        results.push({ shopId: id, name, ok: false, msg: e.message });
      }
    }
    emit({
      type: 'summary',
      success: results.filter(r => r.ok).length,
      failed: results.filter(r => !r.ok).length,
      total: results.length,
    });
    try { res.end(); } catch { /* ignore */ }
  })().catch((e) => {
    try { emit({ type: 'fatal', msg: `导出失败：${e.message}` }); res.end(); } catch { /* ignore */ }
  });
}

module.exports = { exportShop, handleExport };
