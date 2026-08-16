'use strict';
// 开放平台统一出站客户端：签名 + 授权链接 / 换 token / 刷新 / 通用接口调用。
// 供 openapi.js 路由与后续功能模块共用：后续模块只需
//   const { callOpenApi } = require('../openapi/client');
//   await callOpenApi('/api/v2/xxx/yyy', { 业务参数 }, { shopId });
// 即自动完成 partner 配置读取、签名、附带 token 与过期自动刷新。
//
// 参数放置规则（以官方网关实测报错与 laraditz/shopee、shoapi 等 SDK 实现为准）：
// - auth_partner 不发起接口调用：授权链接在本地直接拼接为 GET URL
//   （https://partner.<host>/api/v2/shop/auth_partner?partner_id=…&timestamp=…&sign=…&redirect=…）
// - 其余接口一律 POST：公共参数（partner_id / timestamp / sign，及 access_token / shop_id）
//   放 URL query，业务参数放 JSON body（网关从 query 读公共参数，body 缺 partner_id 会报
//   error_param: There is no partner_id in query）。
// - 签名 base：无 token 时 = partner_id + api_path + timestamp；
//   带 token 时 = partner_id + api_path + timestamp + access_token + shop_id。
const { request } = require('../lib/http');
const { ENV_HOSTS, API_PATH, ACCESS_EXPIRE_MARGIN } = require('./constants');
const { buildBaseString, hmacHex, nowSec } = require('../lib/openapi-utils');
const store = require('./store');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
  if (/invalid_acceess_token|invalid access_token/i.test(text)) {
    return 'access_token 对当前店铺无效，请刷新或重新授权该店铺';
  }
  return ERROR_HINTS[error] || '';
}

function resolveApp() {
  const app = store.getApp();
  if (!app) throw new Error('尚未配置开放平台 App，请先在「开放平台」页面保存 partner_id / partner_key');
  return app;
}

/**
 * 签名请求到开放平台网关。
 * 方法约定（以官方网关实测与 SDK 路由表为准）：
 * - GET（查询类接口，如 get_shop_info）：公共参数 + 业务参数全部放 query，无 body；
 * - POST（写操作 / 换 token 等）：公共参数放 query，业务参数放 JSON body；
 * 网络错误 / 5xx 退避重试 1 次；4xx 与业务 error 不重试。
 * @param {object} opts { env, apiPath, business, accessToken, shopId, signal, method = 'POST' }
 */
async function signedCall({ env, apiPath, business = {}, accessToken = '', shopId = '', signal, method = 'POST' }) {
  const app = store.getApp();
  if (!app) throw new Error('尚未配置开放平台 App，请先在「开放平台」页面保存 partner_id / partner_key');
  const host = ENV_HOSTS[env];
  if (!host) throw new Error('无效的环境：' + env);

  const timestamp = nowSec();
  const base = buildBaseString(app.partnerId, apiPath, timestamp, accessToken, shopId);
  const sign = hmacHex(app.partnerKey, base);
  const common = { partner_id: app.partnerId, timestamp, sign };
  if (accessToken) common.access_token = accessToken;
  if (shopId) common.shop_id = shopId;

  const m = String(method).toUpperCase();
  // 嵌套对象/数组值序列化为 JSON 字符串（GET 查询类接口的复杂参数用）
  const qsOf = (obj) =>
    Object.entries(obj)
      .map(([k, v]) => {
        const val = v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
        return `${encodeURIComponent(k)}=${encodeURIComponent(val)}`;
      })
      .join('&');

  let url;
  let body = null;
  let headers = {};
  if (m === 'GET') {
    url = `${host}${apiPath}?${qsOf(Object.assign({}, common, business))}`;
  } else {
    url = `${host}${apiPath}?${qsOf(common)}`;
    headers = { 'Content-Type': 'application/json' };
    body = JSON.stringify(business);
  }

  const maxAttempts = 2;
  let lastErr;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const resp = await request({
        method: m,
        url,
        headers,
        body,
        timeout: 30000,
        signal,
      });
      if (resp.status >= 500 && resp.status < 600 && attempt < maxAttempts) {
        await sleep(1000);
        continue;
      }
      const j = resp.json;
      if (!j || typeof j !== 'object') {
        throw new Error(`开放平台返回异常（HTTP ${resp.status}）: ${(resp.text || '').slice(0, 200)}`);
      }
      if (j.error) {
        const hint = hintOf(j.error, j.message);
        throw new Error(`开放平台错误 ${j.error}${j.message ? '：' + j.message : ''}${hint ? '（' + hint + '）' : ''}`);
      }
      return j;
    } catch (e) {
      lastErr = e;
      if (signal && signal.aborted) throw e;
      if (attempt < maxAttempts && e.message && e.message.includes('开放平台错误')) {
        // 业务错误不重试（避免重复副作用）
        break;
      }
      if (attempt < maxAttempts) await sleep(1000);
    }
  }
  throw lastErr || new Error('开放平台请求失败');
}

/**
 * 生成卖家授权链接（GET URL 本地拼接，不发起接口调用）：
 * https://partner.<host>/api/v2/shop/auth_partner?partner_id=…&timestamp=…&sign=…&redirect=…
 * 链接约 30 分钟有效，卖家打开后登录选店授权。
 */
function getAuthUrl(env, redirect) {
  const app = resolveApp();
  const host = ENV_HOSTS[env];
  if (!host) throw new Error('无效的环境：' + env);
  const timestamp = nowSec();
  const base = buildBaseString(app.partnerId, API_PATH.authPartner, timestamp);
  const sign = hmacHex(app.partnerKey, base);
  const params = { partner_id: app.partnerId, timestamp, sign, redirect };
  const authUrl = `${host}${API_PATH.authPartner}?${new URLSearchParams(params).toString()}`;
  return { authUrl, expire: 0 };
}

/**
 * 授权码换 token：POST /api/v2/auth/token/get（业务参数 code/shop_id/main_account_id 放 body）。
 * 主账号授权时回调只带 code + main_account_id（无 shop_id），这里用 main_account_id 换，
 * 官方返回 shop_id_list（该主账号下全部已授权店铺）。
 */
async function exchangeToken(env, { code, shopId, mainAccountId }) {
  const business = { code };
  if (shopId) business.shop_id = shopId;
  if (mainAccountId) business.main_account_id = mainAccountId;
  const j = await signedCall({ env, apiPath: API_PATH.tokenGet, business });
  if (!j.access_token || !j.refresh_token) {
    throw new Error('未获取到 access_token / refresh_token');
  }
  const merchantId = Array.isArray(j.merchant_id_list) && j.merchant_id_list[0] ? String(j.merchant_id_list[0]) : '';
  const authorizedShopIds = Array.isArray(j.shop_id_list) && j.shop_id_list.length
    ? j.shop_id_list.map(String)
    : shopId ? [String(shopId)] : [];
  return {
    accessToken: j.access_token,
    refreshToken: j.refresh_token,
    expireIn: j.expire_in || 0,
    merchantId,
    authorizedShopIds,
  };
}

/** 刷新 token：POST /api/v2/auth/access_token/get
 * 实测网关规则（2026-08 生产环境）：
 * - 签名 base 只拼 partner_id + api_path + timestamp（不拼 access_token/shop_id）
 * - 公共参数 partner_id/timestamp/sign 放 query
 * - body 为 { partner_id: 数字, shop_id: 数字, refresh_token }（partner_id/shop_id 必须数字类型，
 *   字符串会报 "the format of xxx parameter is wrong"）
 * - 旧 refresh_token 调用后立即失效 */
async function refreshToken(env, shopId, refreshToken) {
  const app = store.getApp();
  if (!app) throw new Error('尚未配置开放平台 App');
  const host = ENV_HOSTS[env];
  if (!host) throw new Error('无效的环境：' + env);
  const timestamp = nowSec();
  const base = buildBaseString(app.partnerId, API_PATH.accessTokenGet, timestamp);
  const sign = hmacHex(app.partnerKey, base);
  const url = `${host}${API_PATH.accessTokenGet}?${new URLSearchParams({
    partner_id: app.partnerId,
    timestamp: String(timestamp),
    sign,
  }).toString()}`;
  const resp = await request({
    method: 'POST',
    url,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      partner_id: Number(app.partnerId),
      shop_id: Number(shopId),
      refresh_token: refreshToken,
    }),
    timeout: 30000,
  });
  const j = resp.json;
  if (!j || typeof j !== 'object') {
    throw new Error(`开放平台返回异常（HTTP ${resp.status}）: ${(resp.text || '').slice(0, 200)}`);
  }
  if (j.error) {
    const hint = hintOf(j.error, j.message);
    throw new Error(`开放平台错误 ${j.error}${j.message ? '：' + j.message : ''}${hint ? '（' + hint + '）' : ''}`);
  }
  if (!j.access_token || !j.refresh_token) {
    throw new Error('刷新未返回新 token');
  }
  return {
    accessToken: j.access_token,
    refreshToken: j.refresh_token,
    expireIn: j.expire_in || 0,
  };
}

/**
 * 把刷新结果写回凭证库（先拿到新 token 再写盘）。
 * 实测语义（2026-08 生产环境）：主账号授权得到的 token 为账号级通用，但
 * access_token/get 返回的新 token 对**绑定到发起刷新的那个 shop_id**——
 * 其它店铺拿它调接口会报 Invalid access_token，拿它刷新会报 refresh token 或 shop_id 错误。
 * 因此刷新结果只写回发起刷新的店铺，不跨店传播；其余店铺失效时需重新授权
 * （大屏/开放平台页会给出对应提示）。
 * @returns 更新的店铺数（恒为 1）
 */
function saveRefreshResult(env, shopId, oldRefreshToken, fresh) {
  store.setShop(env, shopId, {
    accessToken: fresh.accessToken,
    refreshToken: fresh.refreshToken,
    accessExpireAt: nowSec() + fresh.expireIn,
  });
  return 1;
}

/** 测试用：拉取店铺信息验证 token 有效性（get_shop_info 为 GET 查询类接口） */
async function getShopInfo(env, shopId, accessToken) {
  const j = await signedCall({ env, apiPath: API_PATH.getShopInfo, accessToken, shopId, method: 'GET' });
  const name = j.shop_name || (j.data && j.data.shop_name) || '';
  return { shopId: String(shopId), shopName: String(name) };
}

// per-shop 刷新锁：并发调用同一店铺接口时只触发一次刷新
const refreshLocks = new Map(); // shopId -> Promise
// 全局刷新串行链：主账号下各店铺共享同一 refresh_token（刷新即轮换），
// 跨店铺并发刷新会互相踩踏（后发者拿到已失效的旧 token），统一串行执行
let refreshChain = Promise.resolve();

function ensureFresh(env, shopId) {
  const shop = store.getShop(env, shopId);
  if (!shop) throw new Error(`店铺 ${shopId} 尚未授权，请先在「开放平台」页面完成店铺授权`);
  const remain = (shop.accessExpireAt || 0) - nowSec() - ACCESS_EXPIRE_MARGIN;
  if (remain > 0) return Promise.resolve(shop.accessToken);
  // 过期：先刷新（同一店铺的并发刷新共享同一个 Promise）
  let p = refreshLocks.get(String(shopId));
  if (!p) {
    p = refreshChain.then(async () => {
      try {
        // 串行轮到本店时重读最新 refresh_token（可能已被其它店铺的刷新轮换）
        const latest = store.getShop(env, shopId);
        if (!latest) throw new Error(`店铺 ${shopId} 尚未授权，请先在「开放平台」页面完成店铺授权`);
        const oldRefresh = latest.refreshToken;
        const fresh = await refreshToken(env, shopId, oldRefresh);
        saveRefreshResult(env, shopId, oldRefresh, fresh);
        return fresh.accessToken;
      } finally {
        refreshLocks.delete(String(shopId));
      }
    });
    refreshLocks.set(String(shopId), p);
    // 单个刷新失败不能卡死后续排队（错误由本次调用方消化）
    refreshChain = p.catch(() => {});
  }
  return p;
}

/**
 * 通用开放平台接口调用（后续功能统一入口）。
 * 自动读取 App 配置、附带 access_token / shop_id 并签名；
 * access_token 过期先自动刷新；autoRefresh=false 时不重试认证类错误。
 * @param {string} apiPath 完整接口路径（如 /api/v2/product/get_item_list）
 * @param {object} business 业务参数（不含公共参数）
 * @param {object} opts { shopId, signal, autoRefresh = true, method = 'POST' }
 *   method：查询类接口（get_* 与 search_* 开头）官方用 GET，需显式传 'GET'
 */
async function callOpenApi(apiPath, business = {}, opts = {}) {
  const { shopId, signal, method } = opts;
  const autoRefresh = opts.autoRefresh !== false;
  const app = resolveApp();
  const id = String(shopId || '');
  if (!id) throw new Error('缺少 shop_id');
  const accessToken = await ensureFresh(app.env, id);
  try {
    return await signedCall({ env: app.env, apiPath, business, accessToken, shopId: id, signal, method });
  } catch (e) {
    // 认证类错误：刷新一次后重试（一次机会，避免死循环）。
    // 网关存在拼写变体 invalid_acceess_token，以及 refresh token 失效的误导性文案，一并纳入
    if (autoRefresh && e.message && /error_auth|error_access_token|invalid_acceess_token|invalid access_token|refresh token or shop_id is wrong/.test(e.message)) {
      refreshLocks.delete(id);
      const fresh = await ensureFresh(app.env, id);
      return signedCall({ env: app.env, apiPath, business, accessToken: fresh, shopId: id, signal, method });
    }
    throw e;
  }
}

module.exports = {
  getAuthUrl,
  exchangeToken,
  refreshToken,
  saveRefreshResult,
  getShopInfo,
  callOpenApi,
  signedCall,
};
