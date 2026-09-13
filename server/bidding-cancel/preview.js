'use strict';
// 取消竞价预览（JSON，非 SSE）：扫描各店「待改进」竞价。
const { sendJson } = require('../lib/http-utils');
const {
  DEFAULT_REGION, loadCookieHeader, loadStoreNames, storeNameOf, fetchShopRegion,
} = require('../lib/shopee-session');
const { fetchImprovementBids } = require('./api');

async function handlePreview(body, res) {
  const shopIds = Array.isArray(body.shopIds) ? body.shopIds : [];
  if (shopIds.length === 0) {
    sendJson(res, 400, { ok: false, msg: '请先选择至少一个店铺' });
    return;
  }
  const storeNames = loadStoreNames();
  let cookieHeader;
  try {
    cookieHeader = loadCookieHeader();
  } catch (e) {
    sendJson(res, 400, { ok: false, msg: e.message });
    return;
  }

  const shops = [];
  for (const id of shopIds) {
    const name = storeNameOf(id, storeNames);
    try {
      const region = (await fetchShopRegion(cookieHeader, String(id))) || DEFAULT_REGION;
      const rows = await fetchImprovementBids(cookieHeader, String(id), region);
      shops.push({
        shopId: String(id),
        name,
        ok: true,
        msg: '',
        region,
        itemCount: new Set(rows.map(r => r.itemId)).size,
        bidCount: rows.length,
        items: rows,
      });
    } catch (e) {
      shops.push({ shopId: String(id), name, ok: false, msg: e.message, region: '', itemCount: 0, bidCount: 0, items: [] });
    }
  }
  sendJson(res, 200, { ok: true, shops });
}

module.exports = { handlePreview };
