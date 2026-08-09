// Shopee 视频上传凭证抓取 - 后台服务
// 监听浏览器请求，自动抓取三项凭证并推送到本地工具 http://localhost:3000
// v1.1：凭证缓存到 chrome.storage.local，本地服务未启动时抓取的凭证不会丢失，
//        下次抓到新请求 / 点击扩展图标时自动补推。
const LOCAL = 'http://localhost:3000/api/creds';
const creds = { auth: '', cookie: '', shopId: '' };
let pushing = false;

// 启动时恢复上次缓存的凭证（auth 时效短，主要靠 cookie 长效；cookie 由服务端自动换新 token）
chrome.storage.local.get('creds', (r) => {
  if (r && r.creds) {
    if (r.creds.auth) creds.auth = r.creds.auth;
    if (r.creds.cookie) creds.cookie = r.creds.cookie;
    if (r.creds.shopId) creds.shopId = r.creds.shopId;
  }
});

function persist() {
  chrome.storage.local.set({ creds: { auth: creds.auth, cookie: creds.cookie, shopId: creds.shopId } });
}

function push() {
  if (pushing) return;
  if (!creds.auth && !creds.cookie) return;
  pushing = true;
  fetch(LOCAL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(creds),
  })
    .then((r) => r.json())
    .then((j) => {
      if (j && j.ok) console.log('[creds] 推送成功');
    })
    .catch(() => console.warn('[creds] 推送失败（本地工具未启动？），凭证已缓存，稍后会自动补推'))
    .finally(() => { pushing = false; });
}

// 监听发往 shopee.cn 的请求头
chrome.webRequest.onBeforeSendHeaders.addListener(
  (d) => {
    try {
      const u = d.url || '';
      const onUp = u.includes('up-sp.vod.shopee.cn');   // 分片上传域名 → 取 Authorization
      const onSol = u.includes('solutions.shopee.cn');   // 卖家后台域名 → 取 Cookie / shop_id
      const hs = d.requestHeaders || [];
      let changed = false;
      for (const h of hs) {
        const n = (h.name || '').toLowerCase();
        const v = h.value || '';
        // Authorization：VOD 上传 token，形如 NTAwMDcyMjU6...
        if (n === 'authorization' && v.startsWith('NTAw') && v !== creds.auth) {
          creds.auth = v; changed = true;
        }
        // Cookie：优先抓含 video_upload_session_id 的（更完整）
        if (n === 'cookie' && onSol && v.length > 80) {
          if ((v.includes('video_upload_session_id') || !creds.cookie) && v !== creds.cookie) {
            creds.cookie = v; changed = true;
          }
        }
      }
      // shop_id：从 item/list 的 URL 参数取
      if (onSol && u.includes('item/list')) {
        const m = u.match(/[?&]shop_id=(\d+)/);
        if (m && m[1] !== creds.shopId) { creds.shopId = m[1]; changed = true; }
      }
      if (changed) {
        persist();
        push();
      }
    } catch (e) { /* ignore */ }
  },
  { urls: ['https://*.shopee.cn/*'] },
  ['requestHeaders', 'extraHeaders']
);

// 点击扩展图标：打开本地工具并补推凭证（解决"先抓凭证、后启动工具"导致漏推的问题）
chrome.action.onClicked.addListener(() => {
  push();
  chrome.tabs.create({ url: 'http://localhost:3000/' });
});
