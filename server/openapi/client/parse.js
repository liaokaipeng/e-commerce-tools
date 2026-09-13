'use strict';
// 开放平台网关响应解析：统一「载荷层口径」（顶层 / response / data）与 token 响应校验，
// 换 token、刷新 token 共用同一份解析，避免同一响应出现两套读法。
const { hintOf } = require('./errors');

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
    throw new Error(`开放平台返回异常（HTTP ${resp.status}）: ${(resp.text || '').slice(0, 200)}`);
  }
  if (raw.error) {
    const hint = hintOf(raw.error, raw.message);
    throw new Error(`开放平台错误 ${raw.error}${raw.message ? '：' + raw.message : ''}${hint ? '（' + hint + '）' : ''}`);
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

module.exports = { pickPayload, parseTokenResponse };
