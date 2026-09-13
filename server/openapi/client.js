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
// 重试 / 退避统一走 lib/retry.js（与视频上传、TikTok 解析等链路共用同一骨架）
const { retry, fixedBackoff } = require('../lib/retry');
const store = require('./store');

// 手动刷新冷却（毫秒）：距上次成功刷新不足该时长、且当前 access_token 仍有效时，手动/批量刷新
// 直接复用当前 token，不再向网关发 access_token/get。官方语义是「旧 refresh_token 用一次即作废」，
// 连续点击会让网关拒绝刚被轮换的凭证，而拒绝文案会被 isAuthDead 判成「凭证死透」，进而把共享
// token 组整组标成「需重新授权」。自动续期与认证失败重试**不走**冷却（见 ensureFresh 的 cooldown 选项），
// 否则坏 token 会被反复复用、白跑一遍就标失效。
const REFRESH_COOLDOWN_MS = 5 * 60 * 1000;

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

/**
 * 刷新计划（纯函数）：决定某店铺 token 到期后如何续期。
 * - individual：独立凭证（各店各自授权/刷新得来），按店铺正常刷新；
 * - group-merchant：主账号共享 token（多店同一 refresh_token）且同属一个 merchant，
 *   用 merchant_id 整组刷新（官方 FAQ138 Q8：主账号下共享 token 对可用 merchant_id 或 shop_id 刷新），
 *   成功后新 token 对传播给全组，避免「首店刷新拖死全组」；
 * - group-nomerchant：共享 token 但无 merchant_id，无法整组续期（单店刷新会绑定该店并拖死全组），
 *   只能重新授权。
 * @param {object} shop 目标店铺 { shopId, refreshToken, merchantId }
 * @param {array} allShops 同环境全部店铺
 */
function planRefresh(shop, allShops) {
  const list = Array.isArray(allShops) ? allShops : [];
  const group = list.filter((s) => s.refreshToken && s.refreshToken === shop.refreshToken);
  if (group.length > 1) {
    const merchants = [...new Set(group.map((s) => s.merchantId).filter(Boolean))];
    if (merchants.length === 1) return { mode: 'group-merchant', merchantId: merchants[0], groupSize: group.length };
    return { mode: 'group-nomerchant', groupSize: group.length };
  }
  return { mode: 'individual' };
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
  // 退避与重试骨架统一走 lib/retry.js（固定 1s 间隔：网关限流窗口固定，指数退避无收益）
  return retry(async () => {
    const resp = await request({
      method: m,
      url,
      headers,
      body,
      timeout: 30000,
      signal,
    });
    const j = resp.json;
    if (!j || typeof j !== 'object') {
      // 5xx 多为网关瞬时故障，交给 retry；其余（含 4xx 非 JSON）视为终态错误
      if (resp.status >= 500 && resp.status < 600) throw new Error(`开放平台网关返回 HTTP ${resp.status}`);
      throw new Error(`开放平台返回异常（HTTP ${resp.status}）: ${(resp.text || '').slice(0, 200)}`);
    }
    if (j.error) {
      const hint = hintOf(j.error, j.message);
      throw new Error(`开放平台错误 ${j.error}${j.message ? '：' + j.message : ''}${hint ? '（' + hint + '）' : ''}`);
    }
    return j;
  }, {
    attempts: maxAttempts,
    waitOf: fixedBackoff(1000),
    // 业务错误不重试（避免重复副作用）；仅网络 / 5xx 重试
    shouldRetry: (e) => !(e.message && e.message.includes('开放平台错误')),
    isAborted: () => !!(signal && signal.aborted),
  });
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
  return { authUrl };
}

/**
 * 授权码换 token：POST /api/v2/auth/token/get（业务参数 code/shop_id/main_account_id 放 body）。
 * 主账号授权时回调只带 code + main_account_id（无 shop_id），这里用 main_account_id 换，
 * 官方返回 shop_id_list（该主账号下全部已授权店铺）。
 */
/**
 * 取网关响应中的有效载荷：多数接口把结果放顶层，少数接口/网关版本会包一层 response / data。
 * 换 token、刷新 token 共用同一口径，避免同一份响应出现两套解析。
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

async function exchangeToken(env, { code, shopId, mainAccountId }) {
  const business = { code };
  if (shopId) business.shop_id = shopId;
  if (mainAccountId) business.main_account_id = mainAccountId;
  const raw = await signedCall({ env, apiPath: API_PATH.tokenGet, business });
  const j = pickPayload(raw, ['access_token', 'refresh_token']);
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
  const base = buildBaseString(pid, API_PATH.accessTokenGet, timestamp);
  const sign = hmacHex(app.partnerKey, base);
  const url = `${host}${API_PATH.accessTokenGet}?${new URLSearchParams({
    partner_id: pid,
    timestamp: String(timestamp),
    sign,
  }).toString()}`;
  const resp = await request({
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

/**
 * 把刷新结果写回凭证库（先拿到新 token 再写盘）。
 * 实测语义（2026-08 生产环境）：主账号授权得到的 token 为账号级通用，但
 * access_token/get 返回的新 token 对**绑定到发起刷新的那个 shop_id**——
 * 其它店铺拿它调接口会报 Invalid access_token，拿它刷新会报 refresh token 或 shop_id 错误。
 * 因此独立凭证的刷新结果只写回发起刷新的店铺，不跨店传播；其余店铺失效时需重新授权
 * （大屏/开放平台页会给出对应提示）。共享 token 组由 planRefresh 决策走整组续期，
 * 不走本函数（见 performRefresh / saveRefreshResultGroup）。
 * @returns 更新的店铺数（恒为 1）
 */
function saveRefreshResult(env, shopId, fresh) {
  store.setShop(env, shopId, {
    accessToken: fresh.accessToken,
    refreshToken: fresh.refreshToken,
    accessExpireAt: nowSec() + fresh.expireIn,
    refreshedAt: Date.now(), // 手动刷新冷却基准（见 REFRESH_COOLDOWN_MS）
    invalid: false,
  });
  return 1;
}

/**
 * 整组写回：把 merchant_id 刷新结果传播给「仍持有同一旧 refresh_token」的全部店铺，
 * 并清除各店失效标记（组内店铺共享主账号 token，刷新成功后全组恢复）。
 * @returns 更新的店铺数
 */
function saveRefreshResultGroup(env, oldRefreshToken, fresh) {
  const group = store.getShopsRaw(env).filter((s) => s.refreshToken === oldRefreshToken);
  for (const s of group) {
    store.setShop(env, s.shopId, {
      accessToken: fresh.accessToken,
      refreshToken: fresh.refreshToken,
      accessExpireAt: nowSec() + fresh.expireIn,
      refreshedAt: Date.now(),
      invalid: false,
    });
  }
  return group.length;
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

/** 组内失效标记：把「仍持有同一旧 refresh_token」的店铺全部标记为需重新授权（共享 token 无法续期时） */
function markGroupInvalid(env, oldRefreshToken, reason) {
  const group = store.getShopsRaw(env).filter((s) => s.refreshToken === oldRefreshToken);
  for (const s of group) store.markShopInvalid(env, s.shopId, reason);
  return group.length;
}

/**
 * 确认凭证死透后按分组语义标记：独立凭证只标记本店，共享 token 组整组标记。
 * 手动刷新、自动续期、通用接口调用的失败路径统一走这里，避免「同一件事两套标记口径」。
 */
function markInvalidByPlan(env, shopId, reason) {
  const latest = store.getShop(env, shopId);
  if (!latest) return 0;
  const plan = planRefresh(latest, store.getShopsRaw(env));
  if (plan.mode === 'individual') {
    store.markShopInvalid(env, shopId, reason);
    return 1;
  }
  return markGroupInvalid(env, latest.refreshToken, '主账号共享 token 已失效且无法续期，请到「开放平台」页重新主账号授权一次即可全部恢复');
}

/**
 * 执行一次刷新（无锁，由调用方保证串行），返回 { accessToken, accessExpireAt, synced, mode }。
 * 分组决策统一走 planRefresh —— **手动刷新与自动续期必须是同一条路**：
 * 共享 token 组若被单店刷新，旧 refresh_token 立即作废且新 token 只绑定该店，
 * 其余店铺随后会用已作废的旧 token 去整组续期，导致整组被判「需重新授权」。
 */
async function performRefresh(env, shopId) {
  // 串行轮到本店时重读最新凭证（可能已被其它店铺的刷新轮换/标记失效）
  const latest = store.getShop(env, shopId);
  if (!latest) throw new Error(`店铺 ${shopId} 尚未授权，请先在「开放平台」页面完成店铺授权`);
  if (latest.invalid) {
    throw new Error(`店铺 ${shopId} 授权已失效：${latest.invalidReason || '凭证无效'}（到「开放平台」页重新授权后自动恢复采集）`);
  }
  const oldRefresh = latest.refreshToken;
  const plan = planRefresh(latest, store.getShopsRaw(env));
  if (plan.mode === 'group-merchant') {
    // 共享 token 整组续期：merchant_id 刷新 + 全组传播（单店刷新会绑定该店并拖死其余店铺）
    const fresh = await refreshTokenWithMerchant(env, plan.merchantId, oldRefresh);
    return {
      accessToken: fresh.accessToken,
      accessExpireAt: nowSec() + fresh.expireIn,
      synced: saveRefreshResultGroup(env, oldRefresh, fresh),
      mode: plan.mode,
    };
  }
  if (plan.mode === 'group-nomerchant') {
    // 共享 token 无法整组续期（无 merchant_id 或组内跨多个商户）：整组标记需重新授权，避免每店轮番失败刷网关
    markGroupInvalid(env, oldRefresh, '主账号共享 token 已到期且无法整组续期，请到「开放平台」页重新主账号授权一次即可全部恢复');
    throw new Error('主账号共享 token 已到期且无 merchant_id 可整组续期，请到「开放平台」页重新授权');
  }
  const fresh = await refreshToken(env, shopId, oldRefresh);
  return {
    accessToken: fresh.accessToken,
    accessExpireAt: nowSec() + fresh.expireIn,
    synced: saveRefreshResult(env, shopId, fresh),
    mode: plan.mode,
  };
}

/**
 * 取可用 access_token：未过期直接复用（force=true 跳过该判断，强制走刷新）。
 * 同一店铺的并发刷新共享同一个 Promise；跨店铺刷新统一排进全局串行链（共享 token 轮换防踩踏）。
 * 刷新失败且确认凭证死透时按分组语义标记「需重新授权」。
 * @param {string} env 环境
 * @param {string|number} shopId 店铺 ID
 * @param {object} [opts] { force, cooldown }
 *   force=true 时即使未过期也强制刷新（手动刷新 / 认证失败重试）；
 *   cooldown=true 时（仅手动/批量刷新入口）若距上次成功刷新不足 REFRESH_COOLDOWN_MS 且当前 token 仍有效，
 *   直接复用当前 token 返回 mode='cooldown'，不发网关请求——防连点把刚轮换的凭证刷死。
 *   认证失败重试**不能**开 cooldown，否则复用的还是坏 token（见 callOpenApi）。
 * @returns {Promise<{accessToken: string, accessExpireAt: number, synced: number, mode: string}>}
 */
function ensureFresh(env, shopId, opts = {}) {
  const force = !!opts.force;
  const cooldown = !!opts.cooldown;
  const shop = store.getShop(env, shopId);
  if (!shop) throw new Error(`店铺 ${shopId} 尚未授权，请先在「开放平台」页面完成店铺授权`);
  if (shop.invalid) {
    throw new Error(`店铺 ${shopId} 授权已失效：${shop.invalidReason || '凭证无效'}（到「开放平台」页重新授权后自动恢复采集）`);
  }
  const remain = (shop.accessExpireAt || 0) - nowSec() - ACCESS_EXPIRE_MARGIN;
  // 冷却：手动/批量刷新入口专用。当前 token 仍有效且刚刷过 → 复用，避免连续刷新把凭证刷死
  if (force && cooldown && remain > 0 && shop.refreshedAt && Date.now() - shop.refreshedAt < REFRESH_COOLDOWN_MS) {
    return Promise.resolve({
      accessToken: shop.accessToken,
      accessExpireAt: shop.accessExpireAt || 0,
      synced: 0,
      mode: 'cooldown',
    });
  }
  if (!force && remain > 0) {
    return Promise.resolve({
      accessToken: shop.accessToken,
      accessExpireAt: shop.accessExpireAt || 0,
      synced: 0,
      mode: 'cached',
    });
  }
  // 需要刷新（同一店铺的并发刷新共享同一个 Promise，跨店铺走全局串行链）
  const key = String(shopId);
  let p = refreshLocks.get(key);
  if (!p) {
    p = refreshChain
      .then(() => performRefresh(env, shopId))
      .catch((e) => {
        // 凭证死透：按分组语义标记（共享 token 整组标记，独立凭证只标本店）
        if (isAuthDead(e.message)) markInvalidByPlan(env, shopId, e.message);
        throw e;
      })
      .finally(() => { refreshLocks.delete(key); });
    refreshLocks.set(key, p);
    // 单个刷新失败不能卡死后续排队（错误由本次调用方消化）
    refreshChain = p.catch(() => {});
  }
  return p;
}

/**
 * 强制刷新某店铺（「开放平台」页的「刷新」按钮 / 批量刷新）。
 * 与自动续期走完全相同的分组决策与串行链：共享 token 组会整组续期，
 * 避免「手动刷新单店 → 同组其它店铺的 refresh_token 被作废」。
 * 额外开启冷却（cooldown）：刚刷过且 token 仍有效时直接复用，防连点把刚轮换的凭证刷死
 * （返回 mode='cooldown'，synced=0）。认证失败重试走的是 ensureFresh(force) 而非本函数，不受冷却影响。
 * @returns {Promise<{accessToken: string, accessExpireAt: number, synced: number, mode: string}>}
 */
function refreshShopNow(env, shopId) {
  return ensureFresh(env, shopId, { force: true, cooldown: true });
}

/**
 * 通用开放平台接口调用（后续功能统一入口）。
 * 自动读取 App 配置、附带 access_token / shop_id 并签名；
 * access_token 过期先自动刷新；autoRefresh=false 时不重试认证类错误。
 * 确认凭证死透（刷新后仍报认证错）时把店铺标记为「需重新授权」，供大屏暂停采集并提示。
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
  try {
    const fresh = await ensureFresh(app.env, id);
    const j = await signedCall({ env: app.env, apiPath, business, accessToken: fresh.accessToken, shopId: id, signal, method });
    store.clearShopInvalid(app.env, id);
    return j;
  } catch (e) {
    // 认证类错误：强制刷新一次后重试（一次机会，避免死循环）。
    // 必须带 force —— access_token 名义未过期但被网关拒绝时（例如凭证已被轮换、绑定到其它店铺），
    // 非强制刷新会直接复用同一个 token，重试必然再次失败，白白把店铺标记成「需重新授权」。
    // 网关存在拼写变体 invalid_acceess_token，以及 refresh token 失效的误导性文案，一并纳入
    if (autoRefresh && isAuthRetryable(e.message)) {
      try {
        const fresh = await ensureFresh(app.env, id, { force: true });
        const j = await signedCall({ env: app.env, apiPath, business, accessToken: fresh.accessToken, shopId: id, signal, method });
        store.clearShopInvalid(app.env, id);
        return j;
      } catch (e2) {
        if (isAuthDead(e2.message)) markInvalidByPlan(app.env, id, e2.message);
        throw e2;
      }
    }
    if (isAuthDead(e.message)) markInvalidByPlan(app.env, id, e.message);
    throw e;
  }
}

module.exports = {
  getAuthUrl,
  exchangeToken,
  refreshToken,
  refreshTokenWithMerchant,
  saveRefreshResult,
  saveRefreshResultGroup,
  getShopInfo,
  callOpenApi,
  signedCall,
  ensureFresh,
  refreshShopNow,
  pickPayload,
  // 纯函数（单测覆盖）
  isAuthDead,
  isAuthRetryable,
  planRefresh,
  REFRESH_COOLDOWN_MS,
};
