'use strict';
// 开放平台（Shopee Open Platform v2）纯函数工具：签名与凭证打码。
// 供 server/openapi/ 各模块共用；纯函数便于单测（test/unit.test.js）。
const crypto = require('crypto');

/** 当前秒级时间戳（签名 timestamp 用，必须为整数秒） */
function nowSec() {
  return Math.floor(Date.now() / 1000);
}

/**
 * 拼签名字符串（v2 规则）：
 * - 无 access_token：partner_id + api_path + timestamp
 * - 带 access_token：partner_id + api_path + timestamp + access_token + shop_id
 */
function buildBaseString(partnerId, apiPath, timestamp, accessToken, shopId) {
  const base = `${partnerId}${apiPath}${timestamp}`;
  if (accessToken && shopId) return `${base}${accessToken}${shopId}`;
  if (accessToken || shopId) return base + (accessToken || '') + (shopId || '');
  return base;
}

/** HMAC-SHA256 十六进制签名（小写 hex） */
function hmacHex(key, data) {
  return crypto.createHmac('sha256', key).update(data, 'utf8').digest('hex');
}

/**
 * 凭证打码：保留前 8 后 4 位，中间 ***；过短只留尾部；非字符串返回空。
 * 用于接口响应与日志，避免完整 token / partner_key 外泄。
 */
function maskToken(tok) {
  const s = String(tok || '');
  if (!s) return '';
  if (s.length <= 12) return s.slice(0, 1) + '***' + s.slice(-1);
  return s.slice(0, 8) + '***' + s.slice(-4);
}

module.exports = { nowSec, buildBaseString, hmacHex, maskToken };
