'use strict';
const fs = require('fs');
const path = require('path');
const { authExpOf } = require('../lib/video-utils');
const { call } = require('./request');
const { SITES, SOLUTIONS, UA } = require('./constants');

// ------- 自动凭证存储（浏览器扩展推送，网页读取） -------
// 出站请求统一走 lib/http 的 request（useJar=true 由 lib 内部按 host 维护分片会话 Cookie 罐）。
// 跨境 cn 支持多店铺：storedCreds.cn = { shops: { [shopId]: { auth, cookie, userid, updatedAt } } }
// 本土 ph 保持单店铺：storedCreds.ph = { auth, cookie, shopId, userid, updatedAt }
const CREDS_FILE = path.join(__dirname, '..', 'data', 'video-session.json');
let storedCreds = {}; // site -> creds

// 旧扁平凭证格式 {auth,cookie,shopId,userid,updatedAt} → 统一结构（字段缺省为空）
function flatCreds(o) {
  return {
    auth: o.auth || '',
    cookie: o.cookie || '',
    shopId: o.shopId || '',
    userid: o.userid || '',
    updatedAt: o.updatedAt || 0,
  };
}

// 从扩展推送的原始对象中提取可存凭证（auth 需为合法 token 前缀、cookie 需足够长，避免存垃圾值）
function credsPatch(src, withShopId) {
  const patch = {};
  if (src.auth && src.auth.startsWith('NTAw')) patch.auth = src.auth;
  if (src.cookie && src.cookie.length > 80) patch.cookie = src.cookie;
  if (withShopId && src.shopId) patch.shopId = String(src.shopId);
  if (src.userid) patch.userid = String(src.userid);
  return patch;
}

function loadCredsFile() {
  let raw = {};
  try {
    if (fs.existsSync(CREDS_FILE)) raw = JSON.parse(fs.readFileSync(CREDS_FILE, 'utf8'));
  } catch (e) {
    console.warn('读取视频凭证文件失败:', e.message);
    return;
  }
  // 兼容旧格式：顶层 {auth,cookie,shopId} 视为跨境 cn → 归入 shops
  if (raw.auth || raw.cookie || raw.shopId) {
    const flat = flatCreds(raw);
    if (flat.shopId) storedCreds.cn = { shops: { [String(flat.shopId)]: flat } };
  }
  for (const s of Object.keys(SITES)) {
    const v = raw[s];
    if (!v || typeof v !== 'object') continue;
    if (s === 'cn') {
      if (v.shops && typeof v.shops === 'object') storedCreds.cn = { shops: v.shops };
      else if (v.cookie || v.auth || v.shopId) {
        const flat = flatCreds(v);
        if (flat.shopId) storedCreds.cn = { shops: { [String(flat.shopId)]: flat } };
      }
    } else if (v.cookie || v.auth || v.shopId || v.userid) {
      storedCreds[s] = v;
    }
  }
}
function saveCredsFile() {
  try {
    fs.mkdirSync(path.dirname(CREDS_FILE), { recursive: true });
    fs.writeFileSync(CREDS_FILE, JSON.stringify(storedCreds, null, 2));
  }
  catch (e) { console.warn('保存视频凭证文件失败:', e.message); }
}
function getCreds(site) {
  return storedCreds[site] || { auth: '', cookie: '', shopId: '', userid: '' };
}
function setCredsFor(site, patch) {
  storedCreds[site] = Object.assign(getCreds(site), patch, { updatedAt: Date.now() });
  saveCredsFile();
}
// 跨境 cn 多店铺存取
function cnShops() {
  return (storedCreds.cn && storedCreds.cn.shops) || {};
}
function getCnShop(shopId) {
  return cnShops()[String(shopId)] || { auth: '', cookie: '', userid: '' };
}
function setCnShop(shopId, patch) {
  const id = String(shopId);
  const shops = cnShops();
  shops[id] = Object.assign(getCnShop(id), patch, { updatedAt: Date.now() });
  storedCreds.cn = Object.assign(storedCreds.cn || {}, { shops });
  saveCredsFile();
}
loadCredsFile();

// 用 Cookie 尝试从授权接口换取新上传凭证，换到返回 token，换不到返回空字符串。
// 注意：部分账号类型的授权接口不返回可换取的凭证，此时依赖扩展在手动上传时抓取的凭证（账号级通用）。
async function refreshAuthToken(cookie, shopId, signal) {
  const resp = await call({
    method: 'GET',
    url: `${SOLUTIONS}/sellers/video-upload/api/v1/lib/authorization?shop_id=${encodeURIComponent(shopId)}`,
    signal,
    headers: {
      accept: 'application/json, text/plain, */*',
      cookie,
      origin: 'https://solutions.shopee.cn',
      referer: 'https://solutions.shopee.cn/sellers/video-upload/',
      'user-agent': UA,
    },
  });
  // 优先直接匹配响应文本中的 VOD token（形如 NTAw...），其次兜底 JWT 前缀拼接
  const text = typeof resp.text === 'string' ? resp.text : JSON.stringify(resp.json);
  const m = text.match(/NTAw[A-Za-z0-9_\-=]{20,}/);
  if (m) return m[0];
  const jwt = text.match(/eyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}/);
  return jwt ? 'NTAwMDcyMjU6' + jwt[0] : '';
}

// 解析 Authorization（base64("50007225:<jwt>")）里 JWT 的 exp（秒级时间戳），解析失败返回 0
// （实现见 lib/video-utils.js 的 authExpOf）

// 跨境凭证统一解析（唯一入口），优先级：本地已抓凭证（账号级通用，取有效期最长的）→ Cookie 换取 → 报错引导手动上传
async function resolveCnAuth(creds, log, signal) {
  const nowSec = Date.now() / 1000;
  const candidates = [];
  if (creds.auth) candidates.push({ from: '当前所选', auth: creds.auth });
  for (const [id, s] of Object.entries(cnShops())) {
    if (s && s.auth) candidates.push({ from: `店铺 ${id}`, auth: s.auth });
  }
  candidates.sort((a, b) => authExpOf(b.auth) - authExpOf(a.auth));
  const best = candidates.find((c) => authExpOf(c.auth) > nowSec + 60);
  if (best) {
    const exp = authExpOf(best.auth);
    log('auth', `使用已抓取的上传凭证（${best.from}，到期 ${new Date(exp * 1000).toLocaleString('zh-CN', { hour12: false })}）`);
    return best.auth;
  }
  if (creds.cookie && creds.shopId) {
    log('auth', '本地无有效凭证，尝试用 Cookie 换取新凭证...');
    try {
      const token = await refreshAuthToken(creds.cookie, creds.shopId, signal);
      if (token) {
        setCnShop(creds.shopId, { auth: token });
        log('auth', '凭证换取成功');
        return token;
      }
    } catch (e) {
      log('auth', `凭证换取异常: ${e.message}`);
    }
  }
  throw new Error('无可用上传凭证（Authorization 缺失或已过期）。请登录卖家中心，在任一跨境店铺的「短视频上传」页面手动上传一次视频，扩展抓到凭证后，同账号下所有店铺（含不同国家站点）均可直接批量上传。');
}

module.exports = {
  storedCreds,
  credsPatch,
  getCreds,
  setCredsFor,
  getCnShop,
  setCnShop,
  resolveCnAuth,
};
