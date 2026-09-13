'use strict';
/**
 * 卖家中心内部接口请求层（竞价系三模块共用）
 *
 * 原先 bidding / bidding-cancel / hotlisting-cancel 各自复制一份
 * buildUrl + apiGet/apiPost + fetchShopRegion，已出现「失败兜底 '' vs 'ph'」等行为漂移，
 * 现统一收敛到本模块，各模块只传业务参数。
 */
const { request } = require('../http');
const { assertLoginOk } = require('./session');
const { HOST, UA } = require('./constants');

/**
 * 拼卖家中心接口 URL：公共查询参数 SPC_CDS_VER / SPC_CDS / cnsc_shop_id / cbsc_shop_region 统一附加。
 * business 中的空值项自动跳过（沿用各接口原有拼法，不产出 `key=` 空参）。
 * @param {string} apiPath 接口路径（如 '/api/mkt/buybox/update_enroll'）
 * @param {object} o { shopId, region, spcCds, business }
 */
function buildShopeeUrl(apiPath, { shopId, region, spcCds, business } = {}) {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(business || {})) {
    if (v === null || v === undefined || v === '') continue;
    params.set(k, String(v));
  }
  params.set('SPC_CDS_VER', '2');
  if (spcCds) params.set('SPC_CDS', spcCds);
  if (shopId !== null && shopId !== undefined && String(shopId) !== '') params.set('cnsc_shop_id', String(shopId));
  if (region) params.set('cbsc_shop_region', String(region));
  return `${HOST}${apiPath}?${params.toString()}`;
}

/** 统一出站请求头（卖家中心内部接口）：Cookie / UA / Origin，Referer 可选 */
function shopeeHeaders(cookieHeader, referer) {
  const headers = {
    Cookie: cookieHeader,
    'User-Agent': UA,
    Accept: 'application/json, text/plain, */*',
    Origin: HOST,
  };
  if (referer) headers.Referer = referer;
  return headers;
}

/** 断言接口业务码：非 0（且已声明 code）即抛错，错误信息带 label 便于定位 */
function assertApiOk(json, label) {
  if (json.code !== 0 && json.code !== undefined) {
    throw new Error(`${label}：接口错误 code=${json.code} msg=${json.msg || json.message || json.user_message || ''}`);
  }
  return json;
}

/** 统一的响应解析：非 JSON 对象与业务码非 0 一律抛错 */
function parseApiResponse(resp, label) {
  const j = resp.json;
  if (!j || typeof j !== 'object') {
    throw new Error(`${label}：接口返回异常 ${String(resp.text || '').slice(0, 120)}`);
  }
  return assertApiOk(j, label);
}

/**
 * GET 卖家中心接口（查询类）：自动带 Cookie/UA/Origin/Referer，登录失效与业务码非 0 统一抛错。
 * @param {string} url buildShopeeUrl 产物（或完整 URL）
 * @param {string} cookieHeader loadCookieHeader() 的产物
 * @param {object} [o] { referer, label }
 */
async function apiGet(url, cookieHeader, { referer, label = '接口' } = {}) {
  const resp = await request({ url, headers: shopeeHeaders(cookieHeader, referer) });
  assertLoginOk(resp);
  return parseApiResponse(resp, label);
}

/**
 * POST 卖家中心接口（写操作 / 带 body 的查询）：语义同 apiGet。
 * @param {object} [o] { referer, label }
 */
async function apiPost(url, cookieHeader, body, { referer, label = '接口' } = {}) {
  const resp = await request({
    method: 'POST',
    url,
    headers: Object.assign({ 'Content-Type': 'application/json' }, shopeeHeaders(cookieHeader, referer)),
    body: JSON.stringify(body),
  });
  assertLoginOk(resp);
  return parseApiResponse(resp, label);
}

/**
 * 获取店铺市场（shop_info 的 shop_region，小写如 ph/my/vn）。
 * 失败返回空串：调用 cbsc_shop_region 的接口请自行回落 DEFAULT_REGION，
 * 用于图片域名的一侧保持空串（走图片兜底域名）。
 */
async function fetchShopRegion(cookieHeader, shopId) {
  try {
    const url = buildShopeeUrl('/api/framework/selleraccount/shop_info/', { shopId });
    const j = await apiGet(url, cookieHeader, { label: `获取店铺 ${shopId} 市场` });
    const d = j.data || j.result || {};
    if (d.shop_region) return String(d.shop_region).toLowerCase();
  } catch (e) {
    console.warn(`获取店铺 ${shopId} 市场失败: ${e.message}`);
  }
  return '';
}

module.exports = {
  buildShopeeUrl,
  shopeeHeaders,
  assertApiOk,
  parseApiResponse,
  apiGet,
  apiPost,
  fetchShopRegion,
};
