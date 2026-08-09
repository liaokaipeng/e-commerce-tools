// KP工具合集助手 - 后台服务（视频上传凭证抓取）
// 监听 Shopee 请求，自动抓取 Authorization/Cookie/ShopID 并推送到本地工具 http://localhost:8765/api/creds
// 凭证按站点区分：跨境 shopee.cn 与本土各 shopee.{cc}（如菲律宾 shopee.ph）。
// 凭证缓存到 chrome.storage.local，本地服务未启动时抓取的凭证不会丢失，下次抓到新请求时自动补推。
const LOCAL = 'http://localhost:8765/api/creds';
const credsBySite = {}; // site -> { auth, cookie, shopId }
let pushing = false;

// 从请求 URL 识别站点：shopee.{cc} 的后缀。海岛默认忽略路由域名 seller.shopee.sg。
function detectSite(url) {
  const m = url.match(/https?:\/\/(?:[a-z0-9-]+\.)+shopee\.([a-z]{2})(?:\/|$)/i);
  if (!m) return null;
  const cc = m[1].toLowerCase();
  if (cc === 'sg') return null; // 本土路由/指标域名，非卖家后台，忽略
  return cc; // cn / ph / my / ...
}

// 启动时恢复上次缓存的凭证（auth 时效短，主要靠 cookie 长效；cookie 由服务端自动换新 token）
chrome.storage.local.get('credsBySite', (r) => {
  if (r && r.credsBySite) Object.assign(credsBySite, r.credsBySite);
});

function persist() {
  chrome.storage.local.set({ credsBySite });
}

function push() {
  if (pushing) return;
  const entries = Object.entries(credsBySite).filter(([, c]) => c.cookie || c.auth || c.shopId);
  if (!entries.length) return;
  pushing = true;
  const sites = Object.fromEntries(entries);
  fetch(LOCAL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sites }),
  })
    .then((r) => r.json())
    .then((j) => {
      if (j && j.ok) console.log('[creds] 推送成功');
    })
    .catch(() => console.warn('[creds] 推送失败（本地工具未启动？），凭证已缓存，稍后会自动补推'))
    .finally(() => { pushing = false; });
}

// 监听发往各 Shopee 站点与上传域名的请求头
chrome.webRequest.onBeforeSendHeaders.addListener(
  (d) => {
    try {
      const u = d.url || '';
      const site = detectSite(u);
      if (!site) return;
      const onSol = /solutions\.shopee\.cn|creator\.shopee\.|mms\.shopee\./i.test(u); // 卖家/创作者后台 → 取 Cookie / shop_id
      const hs = d.requestHeaders || [];
      let changed = false;
      if (!credsBySite[site]) credsBySite[site] = { auth: '', cookie: '', shopId: '' };
      const creds = credsBySite[site];
      for (const h of hs) {
        const n = (h.name || '').toLowerCase();
        const v = h.value || '';
        // Authorization：跨境 VOD 上传 token，形如 NTAwMDcyMjU6...
        if (n === 'authorization' && v.startsWith('NTAw') && v !== creds.auth) {
          creds.auth = v; changed = true;
        }
        // Cookie：只从卖家/创作者后台域抓取，优先含 video_upload_session_id 的（更完整）
        if (n === 'cookie' && onSol && v.length > 80) {
          if ((v.includes('video_upload_session_id') || !creds.cookie) && v !== creds.cookie) {
            creds.cookie = v; changed = true;
          }
        }
      }
      // shop_id：从 item/list 的 URL 参数取（跨境）
      if (onSol && /item\/list/.test(u)) {
        const m = u.match(/[?&]shop_id=(\d+)/);
        if (m && m[1] !== creds.shopId) { creds.shopId = m[1]; changed = true; }
      }
      if (changed) {
        persist();
        push();
      }
    } catch (e) { /* ignore */ }
  },
  { urls: [
    'https://*.shopee.cn/*',
    'https://*.shopee.ph/*',
    'https://*.shopee.com/*',
    'https://*.shopee.sg/*',
    'https://*.shopee.com.my/*',
    'https://*.usercontent.com/*',
  ] },
  ['requestHeaders', 'extraHeaders']
);

// 从前端上报请求体抓取 userid：本土上传接口（preupload/reportupload）依赖它确定账号区域，
// 缺失会回落到跨区域导致上传失败。userId 出现在 report/add 请求体的 ext 字符串里。
chrome.webRequest.onBeforeRequest.addListener(
  (d) => {
    try {
      const u = d.url || '';
      const site = detectSite(u);
      if (!site) return;
      if (!/supply\/misc\/api\/v1\/frontend\/report\/add/i.test(u)) return;
      if (!d.requestBody || !d.requestBody.raw) return;
      let text = '';
      for (const r of d.requestBody.raw) {
        if (r && r.bytes) text += new TextDecoder().decode(r.bytes);
      }
      const m = text.match(/userId=(\d+)/) || text.match(/"userId":\s*"?(\d+)/);
      if (m && m[1]) {
        if (!credsBySite[site]) credsBySite[site] = { auth: '', cookie: '', shopId: '', userid: '' };
        if (credsBySite[site].userid !== m[1]) {
          credsBySite[site].userid = m[1];
          persist();
          push();
        }
      }
    } catch (e) { /* ignore */ }
  },
  { urls: [
    'https://*.shopee.cn/*',
    'https://*.shopee.ph/*',
    'https://*.shopee.com/*',
    'https://*.shopee.com.my/*',
  ] },
  ['requestBody']
);