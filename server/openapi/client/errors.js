'use strict';
// 开放平台错误文案与分类：把网关 error code / 误导性文案翻译成可执行中文提示，
// 并判定「需重新授权」的终端错误与「可刷新重试」的认证类错误（纯函数）。
// 供 signedCall / parseTokenResponse（文案）与 ensureFresh / callOpenApi（分类）共用，避免同一判定两套口径。

// 常见业务错误 -> 中文提示（响应 error 字段非空即失败；v2 成功时 error 为空字符串）
const ERROR_HINTS = {
  error_invalid_sign: '签名校验失败，请检查 partner_key 是否正确、本机时间是否准确',
  error_invalid_timestamp: '时间戳校验失败，请先校准本机系统时间',
  error_invalid_code: '授权码无效或已使用（授权码一次性、约 30 分钟过期），请重新生成授权链接',
  error_auth: '授权状态无效，请刷新 token 或重新授权店铺',
  error_access_token: 'access_token 无效或已过期，将自动刷新',
  error_refresh_token: 'refresh_token 无效或已过期（30 天内未刷新），请重新授权店铺',
  error_invalid_partner: 'partner_id 无效，请检查开放平台 App 信息',
  error_invalid_shop_id: 'shop_id 无效或店铺未授权',
  error_param: '请求参数缺失或格式错误，请检查调用参数',
};

function hintOf(error, message) {
  const text = String(message || '');
  // 网关对失效凭证的误导性报错（实测文案）→ 翻译成可执行的指引
  if (/refresh token or shop_id is wrong/i.test(text)) {
    return 'refresh_token 已失效或与该店铺不匹配（主账号授权的 token 被某店铺刷新绑定后，其余店铺需重新授权）';
  }
  if (/refresh token or merchant_id is wrong/i.test(text)) {
    return 'refresh_token 已失效或与该商户不匹配，无法整组续期，需重新授权';
  }
  if (/invalid_acceess_token|invalid access_token/i.test(text)) {
    return 'access_token 对当前店铺无效，请刷新或重新授权该店铺';
  }
  return ERROR_HINTS[error] || '';
}

// 网关对「凭证已死透、刷新也救不回来」的报错文案集合（官方 FAQ138：access_token 4 小时有效、
// refresh_token 30 天有效；任一店铺刷新后共享 token 对即不再共享，其余店铺一律需重新授权）。
const AUTH_DEAD_RE = /invalid_acceess_token|invalid access_token|refresh token or shop_id is wrong|refresh token or merchant_id is wrong|refresh_token expired|error_refresh_token/i;

/** 是否为「需重新授权」的终端凭证错误（区别于网络/参数类可重试错误） */
function isAuthDead(message) {
  return AUTH_DEAD_RE.test(String(message || ''));
}

/** 认证类错误（可尝试刷新一次后重试） */
function isAuthRetryable(message) {
  return /error_auth|error_access_token|invalid_acceess_token|invalid access_token|refresh token or shop_id is wrong/i.test(String(message || ''));
}

module.exports = { ERROR_HINTS, hintOf, isAuthDead, isAuthRetryable };
