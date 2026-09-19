'use strict';
// 开放平台统一出站客户端（门面）：签名 + 授权链接 / 换 token / 刷新 / 通用接口调用。
// 供 openapi.js 路由与后续功能模块共用：后续模块只需
//   const { callOpenApi } = require('../openapi/client');
//   await callOpenApi('/api/v2/xxx/yyy', { 业务参数 }, { shopId });
// 即自动完成 partner 配置读取、签名、附带 token 与过期自动刷新。
//
// 实现按职责拆分到 client/ 子模块，本文件只做导出聚合（不含业务逻辑）：
//   client/sign.js      签名与 query 组装（signedCall / refreshToken 共用同一套口径）
//   client/errors.js    错误文案映射与认证失效/可重试判定（纯函数）
//   client/parse.js     网关响应载荷解析（pickPayload / parseTokenResponse）
//   client/transport.js signedCall：签名请求 + 网络/5xx 重试
//   client/refresh.js   refreshToken：按 shop_id 刷新 token 协议
//   client/persist.js   saveRefreshResult：刷新结果只写回本店
//   client/auth.js      授权链接 / 换 token / get_shop_info
//   client/ensure.js    ensureFresh：TTL / 冷却 / per-shop 锁 / 全局串行链编排
//   client/call.js      callOpenApi：通用接口调用 + 认证失败强制刷新重试
//
// 刷新一律按 shop_id、只写回本店：官方 refresh_access_token 要求 shop_id / merchant_id「必须分别刷新」，
// 实测 merchant_id 刷出来的是商户级 token，调店铺级接口会报 invalid_acceess_token（见 docs/开放平台链路.md §3）。
//
// 参数放置规则（以官方网关实测报错与 laraditz/shopee、shoapi 等 SDK 实现为准）：
// - auth_partner 不发起接口调用：授权链接在本地直接拼接为 GET URL
//   （https://partner.<host>/api/v2/shop/auth_partner?partner_id=…&timestamp=…&sign=…&redirect=…）
// - 其余接口一律 POST：公共参数（partner_id / timestamp / sign，及 access_token / shop_id）
//   放 URL query，业务参数放 JSON body（网关从 query 读公共参数，body 缺 partner_id 会报
//   error_param: There is no partner_id in query）。
// - 签名 base：无 token 时 = partner_id + api_path + timestamp；
//   带 token 时 = partner_id + api_path + timestamp + access_token + shop_id。
const { getAuthUrl, exchangeToken, getShopInfo } = require('./auth');
const { refreshToken } = require('./refresh');
const { saveRefreshResult } = require('./persist');
const { ensureFresh, refreshShopNow } = require('./ensure');
const { callOpenApi } = require('./call');
const { signedCall } = require('./transport');
const { pickPayload } = require('./parse');
const { isAuthDead, isAuthRetryable, isAuthFatalAfterRefresh } = require('./errors');
const { REFRESH_COOLDOWN_MS } = require('../constants');

module.exports = {
  getAuthUrl,
  exchangeToken,
  refreshToken,
  saveRefreshResult,
  getShopInfo,
  callOpenApi,
  signedCall,
  ensureFresh,
  refreshShopNow,
  pickPayload,
  // 纯函数（单测覆盖）
  isAuthDead,
  isAuthRetryable,
  isAuthFatalAfterRefresh,
  REFRESH_COOLDOWN_MS,
};
