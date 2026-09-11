/**
 * Shopee 卖家中心共享会话与请求工具（CommonJS）
 *
 * 竞价导出（bidding）/ 取消竞价（bidding-cancel）/ 取消注册 Hot Listing（hotlisting-cancel）/
 * 商品数据导出（product-export）四个模块共用同一份登录 Cookie
 * （server/data/bidding-session.json，由浏览器扩展推送保存）。
 *
 * 本文件收敛原先在各模块中逐字重复的「会话读取 / Cookie 组装 / 登录态断言 / 店铺列表 /
 * 金额换算」逻辑，避免各处靠注释「与 bidding.js 保持一致」人肉维持同步。
 * 另含卖家中心内部接口的统一请求层（buildShopeeUrl / apiGet / apiPost / fetchShopRegion）：
 * 竞价导出、取消竞价、取消 Hot Listing、商品导出四个模块一律经此调用接口，
 * 不再各自复制 URL 拼接与 apiGet/apiPost 样板（历史上已出现兜底值、code 校验不一致的漂移）。
 */
const fs = require('fs');
const path = require('path');
const { request } = require('./http');

const SESSION_FILE = path.join(__dirname, '..', 'data', 'bidding-session.json');
const STORES_FILE = path.join(__dirname, '..', 'config', 'stores.json');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const HOST = 'https://seller.shopee.cn';
/** 店铺市场取不到时的兜底（与各接口原有口径一致：竞价系接口按 ph 拼 cbsc_shop_region） */
const DEFAULT_REGION = 'ph';

// ============ 登录状态 ============
/** 读取会话文件（不存在 / 损坏返回 null） */
function readSession() {
  if (!fs.existsSync(SESSION_FILE)) return null;
  try { return JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8')); }
  catch (e) { console.warn('读取会话文件失败:', e.message); return null; }
}

/** 按目标域过滤会话里的 Cookie（无会话 / 无匹配均抛友好错误） */
function matchCookies(targetDomain) {
  const session = readSession();
  if (!session || !session.cookies || session.cookies.length === 0) {
    throw new Error('未找到登录 Cookie，请先在浏览器点扩展「发送登录信息到本地工具」');
  }
  const matched = session.cookies.filter(c => {
    const d = String(c.domain || '').toLowerCase();
    if (!d) return false;
    const base = d.startsWith('.') ? d.slice(1) : d;
    return targetDomain === base || targetDomain.endsWith('.' + base);
  });
  if (matched.length === 0) {
    throw new Error('没有匹配 seller.shopee.cn 的 Cookie，请重新点扩展推送');
  }
  return matched;
}

/** 组装 Cookie 请求头字符串（bidding / bidding-cancel 用） */
function loadCookieHeader(targetDomain = 'seller.shopee.cn') {
  return matchCookies(targetDomain).map(c => `${c.name}=${c.value}`).join('; ');
}

/** 组装 Cookie 并附带 SPC_CDS 值：{ header, spcCds }（hotlisting-cancel / product-export 用） */
function loadCookie(targetDomain = 'seller.shopee.cn') {
  const matched = matchCookies(targetDomain);
  const header = matched.map(c => `${c.name}=${c.value}`).join('; ');
  const spcCds = (matched.find(c => c.name === 'SPC_CDS') || {}).value || '';
  return { header, spcCds };
}

/** 登录态断言：403 或响应体含 token not found，统一抛出重新登录提示 */
function assertLoginOk(resp) {
  if (resp.status === 403 || (resp.text && resp.text.includes('token not found'))) {
    throw new Error('登录已失效（403 token not found），请重新登录卖家中心并点扩展推送');
  }
}

// ============ 卖家中心内部接口请求（竞价系四模块共用） ============
// 原先 bidding / bidding-cancel / hotlisting-cancel / product-export 各自复制一份
// buildUrl + apiGet/apiPost + fetchShopRegion，已出现「失败兜底 '' vs 'ph'」等行为漂移，
// 现统一收敛到本文件，各模块只传业务参数。

/**
 * 拼卖家中心接口 URL：公共查询参数 SPC_CDS_VER / SPC_CDS / cnsc_shop_id / cbsc_shop_region 统一附加。
 * business 中的空值项自动跳过（沿用各接口原有拼法，不产出 `key=` 空参）。
 * @param {string} apiPath 接口路径（如 '/api/mkt/buybox/update_enroll'）
 * @param {object} o { shopId, region, spcCds, business }
 */
function buildShopeeUrl(apiPath, { shopId, region, spcCds, business } = {}) {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(business || {})) {
    if (v === null || v === undefined || v === '') continue;
    params.set(k, String(v));
  }
  params.set('SPC_CDS_VER', '2');
  if (spcCds) params.set('SPC_CDS', spcCds);
  if (shopId !== null && shopId !== undefined && String(shopId) !== '') params.set('cnsc_shop_id', String(shopId));
  if (region) params.set('cbsc_shop_region', String(region));
  return `${HOST}${apiPath}?${params.toString()}`;
}

/** 统一出站请求头（卖家中心内部接口）：Cookie / UA / Origin，Referer 可选 */
function shopeeHeaders(cookieHeader, referer) {
  const headers = {
    Cookie: cookieHeader,
    'User-Agent': UA,
    Accept: 'application/json, text/plain, */*',
    Origin: HOST,
  };
  if (referer) headers.Referer = referer;
  return headers;
}

/** 断言接口业务码：非 0（且已声明 code）即抛错，错误信息带 label 便于定位 */
function assertApiOk(json, label) {
  if (json.code !== 0 && json.code !== undefined) {
    throw new Error(`${label}：接口错误 code=${json.code} msg=${json.msg || json.message || json.user_message || ''}`);
  }
  return json;
}

/** 统一的响应解析：非 JSON 对象与业务码非 0 一律抛错 */
function parseApiResponse(resp, label) {
  const j = resp.json;
  if (!j || typeof j !== 'object') {
    throw new Error(`${label}：接口返回异常 ${String(resp.text || '').slice(0, 120)}`);
  }
  return assertApiOk(j, label);
}

/**
 * GET 卖家中心接口（查询类）：自动带 Cookie/UA/Origin/Referer，登录失效与业务码非 0 统一抛错。
 * @param {string} url buildShopeeUrl 产物（或完整 URL）
 * @param {string} cookieHeader loadCookieHeader() 的产物
 * @param {object} [o] { referer, label }
 */
async function apiGet(url, cookieHeader, { referer, label = '接口' } = {}) {
  const resp = await request({ url, headers: shopeeHeaders(cookieHeader, referer) });
  assertLoginOk(resp);
  return parseApiResponse(resp, label);
}

/**
 * POST 卖家中心接口（写操作 / 带 body 的查询）：语义同 apiGet。
 * @param {object} [o] { referer, label }
 */
async function apiPost(url, cookieHeader, body, { referer, label = '接口' } = {}) {
  const resp = await request({
    method: 'POST',
    url,
    headers: Object.assign({ 'Content-Type': 'application/json' }, shopeeHeaders(cookieHeader, referer)),
    body: JSON.stringify(body),
  });
  assertLoginOk(resp);
  return parseApiResponse(resp, label);
}

/**
 * 获取店铺市场（shop_info 的 shop_region，小写如 ph/my/vn）。
 * 失败返回空串：调用 cbsc_shop_region 的接口请自行回落 DEFAULT_REGION，
 * 用于图片域名的一侧保持空串（走图片兜底域名）。
 */
async function fetchShopRegion(cookieHeader, shopId) {
  try {
    const url = buildShopeeUrl('/api/framework/selleraccount/shop_info/', { shopId });
    const j = await apiGet(url, cookieHeader, { label: `获取店铺 ${shopId} 市场` });
    const d = j.data || j.result || {};
    if (d.shop_region) return String(d.shop_region).toLowerCase();
  } catch (e) {
    console.warn(`获取店铺 ${shopId} 市场失败: ${e.message}`);
  }
  return '';
}

// ============ 店铺列表（config/stores.json，热载）============
// 便于非技术用户直接增删店铺，无需改代码；每次请求实时读取，改完无需重启服务。
function loadStores() {
  try {
    return JSON.parse(fs.readFileSync(STORES_FILE, 'utf8'));
  } catch (e) {
    console.warn('读取 stores.json 失败:', e.message);
    return [];
  }
}

// ============ 金额 ============
/** 接口返回单位为 1/100000 元（十万分之一元），除以 100000 得元并四舍五入到分 */
function toAmount(v) {
  if (v === null || v === undefined || v === '' || v === '0' || v === 0) return '';
  const n = Number(v) / 100000;
  return Math.round(n * 100) / 100;
}

/** 延时（毫秒） */
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

module.exports = {
  SESSION_FILE,
  STORES_FILE,
  UA,
  HOST,
  DEFAULT_REGION,
  readSession,
  matchCookies,
  loadCookieHeader,
  loadCookie,
  assertLoginOk,
  buildShopeeUrl,
  apiGet,
  apiPost,
  fetchShopRegion,
  loadStores,
  toAmount,
  sleep,
};
