'use strict';
// 开放平台刷新协议：POST /api/v2/auth/access_token/get。
// 与 signedCall 共用 sign.js 的签名/拼 URL，避免在这里重复实现一遍签名与 query 组装。
const http = require('../../lib/http');
const { ENV_HOSTS, API_PATH } = require('../constants');
const { nowSec } = require('../../lib/openapi-utils');
const { commonParams, qsOf } = require('./sign');
const { parseTokenResponse } = require('./parse');

/**
 * 刷新 token：POST /api/v2/auth/access_token/get。
 * 按店铺刷新与按商户整组刷新的请求形态完全一致，仅 body 的标识字段不同，故用 idKey 区分。
 *
 * 实测网关规则（2026-08 生产环境）：
 * - 签名 base 只拼 partner_id + api_path + timestamp（不拼 access_token/shop_id）
 * - 公共参数 partner_id/timestamp/sign 放 query
 * - body 为 { partner_id: 数字, <idKey>: 数字, refresh_token }（id 必须数字类型，
 *   字符串会报 "the format of xxx parameter is wrong"）
 * - 旧 refresh_token 调用后立即失效
 * @param {'shop_id'|'merchant_id'} idKey 按店铺刷新用 shop_id；主账号共享 token 整组刷新用 merchant_id
 */
async function refreshVia(env, idKey, idValue, refreshToken) {
  const store = require('../store'); // 延迟 require：测试按缓存清理隔离凭证实例
  const app = store.getApp();
  if (!app) throw new Error('尚未配置开放平台 App');
  const host = ENV_HOSTS[env];
  if (!host) throw new Error('无效的环境：' + env);
  // 官方要求这两个 id 在 body 里必须是数字类型：缺失/非数字时 Number() 会得到 NaN、
  // JSON 序列化成 null，网关只会回误导性的格式错——这里提前明确报错，避免静默发出坏请求
  const pid = String(app.partnerId == null ? '' : app.partnerId).trim();
  const rid = String(idValue == null ? '' : idValue).trim();
  if (!/^\d+$/.test(pid)) {
    throw new Error(`partner_id 必须为纯数字（当前：${pid || '空'}），请检查「开放平台」页的 App 配置`);
  }
  if (!/^\d+$/.test(rid)) {
    throw new Error(`${idKey} 缺失或非数字（当前：${rid || '空'}），请到「开放平台」页重新授权该店铺`);
  }
  const timestamp = nowSec();
  // 刷新接口签名只拼 partner_id + api_path + timestamp（不带 token）
  const common = commonParams({ partnerId: pid, partnerKey: app.partnerKey, apiPath: API_PATH.accessTokenGet, timestamp });
  const url = `${host}${API_PATH.accessTokenGet}?${qsOf(common)}`;
  const resp = await http.request({
    method: 'POST',
    url,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      partner_id: Number(pid),
      [idKey]: Number(rid),
      refresh_token: refreshToken,
    }),
    timeout: 30000,
  });
  return parseTokenResponse(resp);
}

/** 按店铺刷新单个凭证的 token */
async function refreshToken(env, shopId, refreshToken) {
  return refreshVia(env, 'shop_id', shopId, refreshToken);
}

/**
 * 整组刷新：用 merchant_id 刷新主账号共享 token（官方 FAQ138 Q8：可用 merchant_id 或 shop_id 刷新）。
 * 仅用于「多店铺共享同一 refresh_token 且同属一个 merchant」的场景，成功后新 token 对传播给全组店铺。
 */
async function refreshTokenWithMerchant(env, merchantId, refreshToken) {
  return refreshVia(env, 'merchant_id', merchantId, refreshToken);
}

module.exports = { refreshVia, refreshToken, refreshTokenWithMerchant };
