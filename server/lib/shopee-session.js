/**
 * Shopee 卖家中心共享会话与请求工具（CommonJS）
 *
 * 竞价导出（bidding）/ 取消竞价（bidding-cancel）/ 取消注册 Hot Listing（hotlisting-cancel）/
 * 商品数据导出（product-export）四个模块共用同一份登录 Cookie
 * （server/data/bidding-session.json，由浏览器扩展推送保存）。
 *
 * 本文件收敛原先在各模块中逐字重复的「会话读取 / Cookie 组装 / 登录态断言 / 店铺列表 /
 * 金额换算」逻辑，避免各处靠注释「与 bidding.js 保持一致」人肉维持同步。
 */
const fs = require('fs');
const path = require('path');

const SESSION_FILE = path.join(__dirname, '..', 'data', 'bidding-session.json');
const STORES_FILE = path.join(__dirname, '..', 'config', 'stores.json');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const HOST = 'https://seller.shopee.cn';

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
  readSession,
  matchCookies,
  loadCookieHeader,
  loadCookie,
  assertLoginOk,
  loadStores,
  toAmount,
  sleep,
};
