// 电商工具箱 - 后台服务（视频上传凭证抓取）
// 监听 Shopee 请求，自动抓取 Authorization/Cookie/ShopID/UserId 并推送到本地工具 http://localhost:8765/api/creds
// 凭证按站点区分：跨境 shopee.cn 与本土各 shopee.{cc}（如菲律宾 shopee.ph）。
// 跨境 cn 支持多店铺：每个店铺（shopId）独立保存 cookie/auth。切换店铺后手动上传一次即可新增/更新该店铺凭证。
// 凭证缓存到 chrome.storage.local，本地服务未启动时抓取的凭证不会丢失，下次抓到新请求时自动补推。
const LOCAL = 'http://localhost:8765/api/creds';
const credsBySite = {}; // site -> { shops: { [shopId]: {auth,cookie,userid,updatedAt} }, curShopId, pending }
let pushing = false;
let lastPushedJson = ''; // 上次推送成功的内容快照：恢复补推/重试时内容没变就跳过，避免无效请求

// 从请求 URL 识别站点：shopee.{cc} 的后缀。海岛默认忽略路由域名 seller.shopee.sg。
function detectSite(url) {
  const m = url.match(/https?:\/\/(?:[a-z0-9-]+\.)+shopee\.([a-z]{2})(?:\/|$)/i);
  if (!m) return null;
  const cc = m[1].toLowerCase();
  if (cc === 'sg') return null; // 本土路由/指标域名，非卖家后台，忽略
  return cc; // cn / ph / my / ...
}

// 确保站点对象存在，返回它
function siteObj(site) {
  if (!credsBySite[site]) credsBySite[site] = { shops: {}, curShopId: null, pending: null };
  return credsBySite[site];
}
// 获取（必要时创建）某店铺凭证对象
function shopObj(site, shopId) {
  const c = siteObj(site);
  const id = String(shopId);
  if (!c.shops[id]) c.shops[id] = { auth: '', cookie: '', userid: '', updatedAt: 0 };
  return c.shops[id];
}

// 启动时恢复上次缓存的凭证（auth 时效短，主要靠 cookie 长效；cookie 由服务端自动换新 token）
chrome.storage.local.get('credsBySite', (r) => {
  if (r && r.credsBySite) {
    for (const [site, c] of Object.entries(r.credsBySite)) {
      if (!c || typeof c !== 'object') continue;
      let shops = c.shops;
      if (!shops && c.shopId) {
        // 旧扁平格式 { auth, cookie, shopId, userid } → 迁移到 shops
        shops = { [String(c.shopId)]: { auth: c.auth || '', cookie: c.cookie || '', userid: c.userid || '', updatedAt: c.updatedAt || 0 } };
        c.curShopId = String(c.shopId);
      }
      // 恢复是异步的，回调可能晚于 SW 唤醒后首个请求的抓取处理；
      // 必须合并而不是 credsBySite[site] = c 整体覆盖，否则会把竞态期间抓到的数据冲掉
      const cur = siteObj(site);
      for (const [id, s] of Object.entries(shops || {})) {
        const t = shopObj(site, id);
        if ((s.updatedAt || 0) > (t.updatedAt || 0)) Object.assign(t, s);
      }
      if (!cur.curShopId && c.curShopId) cur.curShopId = c.curShopId;
      if (c.pending) cur.pending = Object.assign({}, c.pending, cur.pending || {});
    }
  }
  // 恢复后主动补推一次：push() 只在「抓到的值变化」时被触发，若扩展重载 / 上次推送时
  // 服务端没开，之后抓到的值与缓存一致 → changed 恒为 false → 凭证永远滞留不再推送。
  // MV3 service worker 每次被请求事件唤醒都会重跑本脚本，等价于「有缓存凭证就补推」的心跳。
  setTimeout(push, 3000);
});

function persist() {
  chrome.storage.local.set({ credsBySite });
}

function push() {
  if (pushing) return;
  const sites = {};
  for (const [site, c] of Object.entries(credsBySite)) {
    const shops = c.shops || {};
    const entries = Object.entries(shops).filter(([, s]) => s && (s.cookie || s.auth || s.userid));
    if (site === 'cn') {
      // 跨境多店铺必须按 shop_id 归档：无 shop_id 的 pending 不推（服务端对无 shopId 的 cn 推送回 400，
      // 且扁平结构会覆盖 { shops } 导致全部店铺凭证丢失）。
      if (!entries.length) continue;
      sites[site] = { shops: Object.fromEntries(entries) };
    } else {
      // 本土单店铺（ph 等）上传链路只依赖 cookie + userid，无需 shop_id 归属。
      // 手动上传不触发 item/list → curShopId 恒为 null → 凭证滞留 pending；
      // 若只推 shops 永远推不出去，服务端始终「暂无本土凭证」。pending 有货时按扁平格式推。
      const p = c.pending || {};
      if (entries.length) {
        sites[site] = { shops: Object.fromEntries(entries) };
      } else if (p.cookie || p.auth || p.userid) {
        sites[site] = { auth: p.auth || '', cookie: p.cookie || '', userid: p.userid || '' };
      } else {
        continue;
      }
    }
  }
  if (!Object.keys(sites).length) return;
  const payload = JSON.stringify(sites);
  // 内容与上次推送成功的完全一致 → 无需再推（MV3 SW 每次唤醒的恢复补推大多走到这里直接返回）
  if (payload === lastPushedJson) return;
  // 诊断日志：只打字段形态（长度/有无），不打凭证值
  const shape = {};
  for (const [s, v] of Object.entries(sites)) {
    shape[s] = v.shops
      ? Object.entries(v.shops).map(([id, x]) => ({ id, cookieLen: (x.cookie || '').length, hasAuth: !!x.auth, useridLen: (x.userid || '').length }))
      : { cookieLen: (v.cookie || '').length, hasAuth: !!v.auth, useridLen: (v.userid || '').length };
  }
  console.log('[creds] 推送:', JSON.stringify(shape));
  pushing = true;
  fetch(LOCAL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: payload,
  })
    .then((r) => r.json())
    .then((j) => {
      if (j && j.ok) { console.log('[creds] 推送成功'); lastPushedJson = payload; }
      else console.warn('[creds] 推送被拒绝:', j && j.message);
    })
    .catch(() => {
      console.warn('[creds] 推送失败（本地工具未启动？），凭证已缓存，稍后会自动补推');
      // 本地服务多半是暂时没起：定时重试，别等下一次「值变化」才有机会补推
      setTimeout(push, 30000);
    })
    .finally(() => { pushing = false; });
}

// 两个监听器共用的站点过滤列表
const FILTER = { urls: ['https://*.shopee.cn/*', 'https://*.shopee.ph/*'] };

// 监听发往跨境（shopee.cn）与本土菲律宾（shopee.ph）站点的请求头
chrome.webRequest.onBeforeSendHeaders.addListener(
  (d) => {
    try {
      const u = d.url || '';
      const site = detectSite(u);
      if (!site) return;
      const onSol = /solutions\.shopee\.cn|creator\.shopee\.|mms\.shopee\./i.test(u); // 卖家/创作者后台 → 取 Cookie / shop_id
      const hs = d.requestHeaders || [];
      const c = siteObj(site);
      let auth = '', cookie = '';
      for (const h of hs) {
        const n = (h.name || '').toLowerCase();
        const v = h.value || '';
        // Authorization：跨境 VOD 上传 token，形如 NTAwMDcyMjU6...
        if (n === 'authorization' && v.startsWith('NTAw')) auth = v;
        // Cookie：只从卖家/创作者后台域抓取，优先含 video_upload_session_id 的（更完整）
        if (n === 'cookie' && onSol && v.length > 80) cookie = v;
      }
      // shop_id：从 item/list 的 URL 参数取（跨境），并据此确定当前店铺
      let shopId = null;
      if (onSol && /item\/list/.test(u)) {
        const m = u.match(/[?&]shop_id=(\d+)/);
        if (m) shopId = m[1];
      }
      let target = null;
      if (shopId) {
        c.curShopId = String(shopId);
        target = shopObj(site, shopId);
        if (c.pending) { Object.assign(target, c.pending); c.pending = null; }
      } else if (site !== 'cn' && (auth || cookie)) {
        // 本土单店铺：URL 里永远没有 shop_id（ph 的 item/list 无该参数，跨境才有），无需归档。
        // 直接落「以站点名为键」的店铺存根并走 target/changed → push()。
        // 不能进 pending：pending 分支不触发推送，Cookie 会永远滞留扩展、服务端只有 userid。
        if (!c.curShopId) c.curShopId = site;
        target = shopObj(site, c.curShopId);
        if (c.pending) { Object.assign(target, c.pending); c.pending = null; }
      } else if (c.curShopId) {
        target = shopObj(site, c.curShopId);
      } else if (auth || cookie) {
        // 尚不知当前店铺（仅跨境会出现），先缓存待定，待 shop_id 出现时归入对应店铺
        if (!c.pending) c.pending = {};
        if (auth) c.pending.auth = auth;
        if (cookie && (cookie.includes('video_upload_session_id') || !c.pending.cookie)) c.pending.cookie = cookie;
        target = null;
      }
      if (target) {
        let changed = false;
        if (auth && auth !== target.auth) { target.auth = auth; changed = true; }
        if (cookie && (cookie.includes('video_upload_session_id') || !target.cookie) && cookie !== target.cookie) {
          target.cookie = cookie; changed = true;
        }
        if (changed) {
          target.updatedAt = Date.now();
          persist();
          push();
        }
      }
    } catch (e) { /* ignore */ }
  },
  FILTER,
  ['requestHeaders', 'extraHeaders']
);

// popup「清空扩展凭证缓存」：内存与 chrome.storage.local 必须一起清——
// 只清存储的话，service worker 里的 credsBySite 会在下次请求时 persist() 写回。
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.type === 'clear-creds-cache') {
    for (const k of Object.keys(credsBySite)) delete credsBySite[k];
    chrome.storage.local.remove('credsBySite', () => sendResponse({ ok: true }));
    console.log('[creds] 扩展凭证缓存已清空（内存 + 本地存储）');
    return true; // 异步响应
  }
});

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
        const c = siteObj(site);
        // 本土单店铺无需 shop_id 归档：直接确定当前店铺存根（与 Cookie 抓取同键，凭证才能合并到一处）
        if (!c.curShopId && site !== 'cn') c.curShopId = site;
        const target = c.curShopId ? shopObj(site, c.curShopId) : (c.pending || (c.pending = {}));
        if (target.userid !== m[1]) {
          target.userid = m[1];
          persist();
          push();
        }
      }
    } catch (e) { /* ignore */ }
  },
  FILTER,
  ['requestBody']
);