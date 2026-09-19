'use strict';
// 开放平台刷新协议：POST /api/v2/auth/access_token/get（按 shop_id 刷新单个店铺）。
// 与 signedCall 共用 sign.js 的签名 / 拼 URL，避免在这里重复实现一遍签名与 query 组装。
//
// **为什么只能按 shop_id 刷新、不能用 merchant_id 整组刷**：
// 官方 refresh_access_token 文档要求 shop_id / merchant_id「必须分别刷新」；FAQ138 Q8 说明
// 主账号（CNSC）授权拿到的共享 token 对一旦被某个 id 刷过就不再共享。实测（2026-09 生产）：
// merchant_id 刷新得到的是**商户级 token**，只能调商户级接口（get_merchant_info 等），
// 拿它去调店铺级接口一律报 invalid_acceess_token。因此每个店铺必须用各自 shop_id 刷新并分别保存。
const http = require('../../lib/http');
const { ENV_HOSTS, API_PATH } = require('../constants');
const { nowSec } = require('../../lib/openapi-utils');
const { commonParams, qsOf } = require('./sign');
const { parseTokenResponse } = require('./parse');

/**
 * 刷新单个店铺的 token：POST /api/v2/auth/access_token/get。
 * 实测网关规则（2026-08/09 生产环境）：
 * - 签名 base 只拼 partner_id + api_path + timestamp（不拼 access_token/shop_id）
 * - 公共参数 partner_id/timestamp/sign 放 query
 * - body 为 { partner_id: 数字, shop_id: 数字, refresh_token }（id 必须数字类型，
 *   字符串会报 "the format of xxx parameter is wrong"）
 * - 旧 refresh_token 调用后立即失效
 */
async function refreshToken(env, shopId, refreshToken) {
  const store = require('../store'); // 延迟 require：测试按缓存清理隔离凭证实例
  const app = store.getApp();
  if (!app) throw new Error('尚未配置开放平台 App');
  const host = ENV_HOSTS[env];
  if (!host) throw new Error('无效的环境：' + env);
  // 官方要求这两个 id 在 body 里必须是数字类型：缺失/非数字时 Number() 会得到 NaN、
  // JSON 序列化成 null，网关只会回误导性的格式错——这里提前明确报错，避免静默发出坏请求
  const pid = String(app.partnerId == null ? '' : app.partnerId).trim();
  const sid = String(shopId == null ? '' : shopId).trim();
  if (!/^\d+$/.test(pid)) {
    throw new Error(`partner_id 必须为纯数字（当前：${pid || '空'}），请检查「开放平台」页的 App 配置`);
  }
  if (!/^\d+$/.test(sid)) {
    throw new Error(`shop_id 缺失或非数字（当前：${sid || '空'}），请到「开放平台」页重新授权该店铺`);
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
      shop_id: Number(sid),
      refresh_token: refreshToken,
    }),
    timeout: 30000,
  });
  return parseTokenResponse(resp);
}

module.exports = { refreshToken };
