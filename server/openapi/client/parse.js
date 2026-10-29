'use strict';
// 开放平台网关响应解析：统一「载荷层口径」（顶层 / response / data）与 token 响应校验，
// 换 token、刷新 token 共用同一份解析，避免同一响应出现两套读法。
const { gatewayError, nonJsonError } = require('./errors');

/**
 * 取网关响应中的有效载荷：多数接口把结果放顶层，少数接口/网关版本会包一层 response / data。
 * @param {object} j 网关原始响应
 * @param {string[]} keys 判定「命中该层」的字段名（任一字段有值即认为该层是目标载荷）
 */
function pickPayload(j, keys) {
  for (const p of [j, j && j.response, j && j.data]) {
    if (!p || typeof p !== 'object') continue;
    if (keys.some((k) => p[k] !== undefined && p[k] !== null && p[k] !== '')) return p;
  }
  return j;
}

/** 解析 access_token/get 响应：非对象 / 带 error 一律抛中文提示，成功返回统一结构 */
function parseTokenResponse(resp) {
  const raw = resp.json;
  if (!raw || typeof raw !== 'object') {
    throw nonJsonError(resp.status, resp.text);
  }
  if (raw.error) {
    throw gatewayError(raw.error, raw.message);
  }
  const j = pickPayload(raw, ['access_token', 'refresh_token']);
  if (!j.access_token || !j.refresh_token) {
    throw new Error('刷新未返回新 token');
  }
  return {
    accessToken: j.access_token,
    refreshToken: j.refresh_token,
    expireIn: j.expire_in || 0,
  };
}

const SHOP_NAME_KEYS = ['shop_name', 'region', 'country', 'shop_region', 'shop_country'];
const SHOP_REGION_KEYS = ['region', 'country', 'shop_region', 'shop_country'];

/**
 * 解析 get_shop_info 响应为 { name, region }：店铺名/地区提取只有这一份口径
 * （stores-view 取名/取地区与监控币种识别共用）。region 保持接口原样大小写，
 * 由调用方按用途处理（列表筛选用大写、币种识别用原样）。
 */
function parseShopInfoPayload(j) {
  const p = pickPayload(j, SHOP_NAME_KEYS) || {};
  const name = p.shop_name ? String(p.shop_name) : '';
  let region = '';
  for (const k of SHOP_REGION_KEYS) {
    if (p[k] !== undefined && p[k] !== null && p[k] !== '') { region = String(p[k]); break; }
  }
  return { name: name || null, region };
}

module.exports = { pickPayload, parseTokenResponse, parseShopInfoPayload };
