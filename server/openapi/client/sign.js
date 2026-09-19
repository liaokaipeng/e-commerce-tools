'use strict';
// 开放平台签名与 query 组装：signedCall（通用接口）与 refreshToken（刷新 token）共用同一套口径，
// 避免两处各写一遍签名 / 拼 URL 导致签名规则漂移。
const { buildBaseString, hmacHex } = require('../../lib/openapi-utils');

/** 把对象序列化为 URL query（嵌套对象/数组值序列化为 JSON 字符串，null/undefined 视为空串） */
function qsOf(obj) {
  return Object.entries(obj)
    .map(([k, v]) => {
      const val = v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
      return `${encodeURIComponent(k)}=${encodeURIComponent(val)}`;
    })
    .join('&');
}

/**
 * 生成签名公共参数（partner_id / timestamp / sign）。
 * 签名 base：无 token 时 = partner_id + api_path + timestamp；
 * 带 token 时 = partner_id + api_path + timestamp + access_token + shop_id。
 * access_token / shop_id 仅在非空时并入公共参数。
 * @param {object} p { partnerId, partnerKey, apiPath, timestamp, accessToken?, shopId? }
 */
function commonParams({ partnerId, partnerKey, apiPath, timestamp, accessToken = '', shopId = '' }) {
  const base = buildBaseString(partnerId, apiPath, timestamp, accessToken, shopId);
  const common = { partner_id: partnerId, timestamp, sign: hmacHex(partnerKey, base) };
  if (accessToken) common.access_token = accessToken;
  if (shopId) common.shop_id = shopId;
  return common;
}

module.exports = { qsOf, commonParams };
