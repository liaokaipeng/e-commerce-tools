'use strict';
// 取消注册预览（JSON，非 SSE）：按 SPU 扫描各店已注册且资格正常的 SKU。
const { sendJson } = require('../lib/http-utils');
const { loadCookie, loadStoreNames, storeNameOf } = require('../lib/shopee-session');
const { loadSpuConfig } = require('./config');
const { resolvePerShopSpus } = require('./parse');
const { regionOf, fetchEnrolledSkus } = require('./api');

/** 扫描单个店铺：逐 SPU 拉已注册且资格正常的 SKU（单 SPU 失败不拖垮整店），返回 shops 数组元素 */
async function scanShop(cookie, id, name, plan) {
  if (plan.error) {
    return { shopId: String(id), name, ok: false, msg: plan.error, region: '', spuCount: 0, skuCount: 0, spus: [] };
  }
  try {
    const region = await regionOf(cookie, String(id));
    const spuRows = [];
    for (const spuId of plan.spus) {
      try {
        const items = await fetchEnrolledSkus(cookie, String(id), region, spuId);
        spuRows.push({ spuId, ok: true, msg: '', skuCount: items.length, items });
      } catch (e) {
        spuRows.push({ spuId, ok: false, msg: e.message, skuCount: 0, items: [] });
      }
    }
    return {
      shopId: String(id),
      name,
      ok: true,
      msg: '',
      region,
      spuCount: plan.spus.length,
      skuCount: spuRows.reduce((n, s) => n + s.skuCount, 0),
      spus: spuRows,
    };
  } catch (e) {
    return { shopId: String(id), name, ok: false, msg: e.message, region: '', spuCount: 0, skuCount: 0, spus: [] };
  }
}

async function handlePreview(body, res) {
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
  const storeNames = loadStoreNames();
  let cookie;
  try {
    cookie = loadCookie();
  } catch (e) {
    sendJson(res, 400, { ok: false, msg: e.message });
    return;
  }

  const shops = [];
  for (const id of shopIds) {
    const name = storeNameOf(id, storeNames);
    const plan = perShop[String(id)] || { error: '未配置 SPU ID' };
    shops.push(await scanShop(cookie, id, name, plan));
  }
  sendJson(res, 200, { ok: true, shops });
}

module.exports = { handlePreview };
