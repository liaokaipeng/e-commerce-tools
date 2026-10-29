'use strict';
// 已授权店铺列表（各工具「选择店铺」唯一数据源，含 region 国家筛选用）。
// 输出当前环境全部已授权店铺的 { category, id, name, region }。
// 店铺名/地区两级缓存：openapi-session.json(shopName/shopRegion) → 监控 meta.json(首次采集时补的名字)；
// 两处都缺才调 get_shop_info 补拉（直接签名调用、不带自动刷新），失败只记失败时间戳、
// 10 分钟内不重试——取名/取地区失败绝不把店铺标记为失效（不影响监控采集与授权状态）。
const store = require('./store');
const client = require('./client');
const { API_PATH } = require('./constants');

const SHOP_NAME_RETRY_MS = 10 * 60 * 1000;
const SHOP_NAME_CONCURRENCY = 5;
let shopNameTask = null; // 单飞：并发请求共享同一次拉取，避免重复打网关

/** 监控大屏缓存的店铺名（meta.json，首次采集时经 get_shop_info 补过） */
function monitorNameMap() {
  try {
    const meta = require('../monitor/store').getMeta();
    const out = {};
    for (const [id, m] of Object.entries((meta && meta.shops) || {})) {
      if (m && m.name) out[String(id)] = String(m.name);
    }
    return out;
  } catch { return {}; } // 监控模块不可用时忽略
}

/** 直调 get_shop_info 补拉缺失的店铺名/地区（不走 callOpenApi：避免认证类失败触发刷新/标记失效） */
async function fetchShopNames(env, shops) {
  let cursor = 0;
  const worker = async () => {
    while (cursor < shops.length) {
      const s = shops[cursor++];
      const patch = {};
      try {
        const j = await client.signedCall({
          env,
          apiPath: API_PATH.getShopInfo,
          accessToken: s.accessToken || '',
          shopId: s.shopId,
          method: 'GET',
        });
        // 店铺名/地区解析与监控采集（collectors.fetchShopInfo）共用同一份口径
        const { name: rawName, region: rawRegion } = client.parseShopInfoPayload(j);
        const name = String(rawName || '').trim();
        if (name) patch.shopName = name;
        else patch.shopNameFailedAt = Date.now();
        if (rawRegion) patch.shopRegion = String(rawRegion).toUpperCase();
        else patch.shopRegionFailedAt = Date.now();
      } catch (e) {
        patch.shopNameFailedAt = Date.now();
        patch.shopRegionFailedAt = Date.now();
        console.warn(`获取店铺 ${s.shopId} 名称/地区失败: ${e.message}`);
      }
      store.setShop(env, s.shopId, patch);
    }
  };
  await Promise.all(Array.from({ length: Math.min(SHOP_NAME_CONCURRENCY, shops.length) }, worker));
}

/** 已授权店铺列表（首次调用会补拉缺失的店铺名/地区，耗时几秒；之后走缓存秒回） */
async function authorizedStores() {
  const app = store.getApp();
  if (!app) return [];
  const mNames = monitorNameMap();
  const now = Date.now();
  const pending = store
    .getShopsRaw(app.env)
    .filter((s) => {
      if (s.invalid) return false;
      const hasName = !!(s.shopName || mNames[s.shopId]);
      const hasRegion = !!s.shopRegion;
      if (hasName && hasRegion) return false;
      // 名字/地区各自有 10 分钟失败冷却；缺的那项被冷却挡住才跳过（两项都缺则都要被挡）
      const nameBlocked = s.shopNameFailedAt && now - s.shopNameFailedAt < SHOP_NAME_RETRY_MS;
      const regionBlocked = s.shopRegionFailedAt && now - s.shopRegionFailedAt < SHOP_NAME_RETRY_MS;
      return (!hasName && !nameBlocked) || (!hasRegion && !regionBlocked);
    });
  if (pending.length) {
    if (!shopNameTask) {
      shopNameTask = fetchShopNames(app.env, pending).finally(() => {
        shopNameTask = null;
      });
    }
    await shopNameTask;
  }
  return store
    .getShopsRaw(app.env)
    // 失效店铺不作为可选目标（选中后调用必然失败）；其状态仍在 /api/openapi/status 与监控大屏展示
    .filter((s) => !s.invalid)
    .map((s) => ({
      category: '开放平台已授权',
      id: s.shopId,
      name: s.shopName || mNames[s.shopId] || `店铺 ${s.shopId}`,
      region: s.shopRegion || '',
    }))
    .sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
}

/**
 * 当前环境店铺名映射 `{ shopId: name }`：供 GET /api/openapi/status 回填「店铺名」列。
 * 复用 authorizedStores 的同一套两级缓存 + 按需补拉（缺名时会触发 get_shop_info，失败 10 分钟冷却），
 * 不另写取名逻辑；失效店铺不在其中（调用方对缺失键自行回落展示）。
 */
async function shopNameMap() {
  const out = {};
  for (const s of await authorizedStores()) out[s.id] = s.name;
  return out;
}

module.exports = { authorizedStores, shopNameMap };
