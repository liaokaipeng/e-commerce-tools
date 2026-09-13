// 扩展 popup：发送登录 Cookie 到本地工具（竞价导出用） + 按类别清理缓存
// 竞价接口只走 seller.shopee.cn，故仅收集 shopee.cn 域的 Cookie
const SERVER_URL = 'http://127.0.0.1:8765/api/cookie';
const CACHE_URL = 'http://127.0.0.1:8765/api/cache';
const PAGE_URL = 'http://127.0.0.1:8765';
const SHOPEE_DOMAINS = ['shopee.cn'];

function isShopeeDomain(domain) {
  return SHOPEE_DOMAINS.some(d => domain === d || domain.endsWith('.' + d));
}

async function collectCookies() {
  const all = await chrome.cookies.getAll({});
  // 保留 Shopee 相关域的 cookie，并按名称去重（优先保留具体域名上的）
  const map = new Map();
  for (const c of all) {
    if (!isShopeeDomain(c.domain)) continue;
    const key = c.name;
    const existing = map.get(key);
    if (!existing || c.domain.length > existing.domain.length) {
      map.set(key, c);
    }
  }
  return Array.from(map.values());
}

document.getElementById('send').addEventListener('click', async () => {
  const btn = document.getElementById('send');
  const status = document.getElementById('status');
  btn.disabled = true;
  status.textContent = '正在读取 Cookie...';
  status.className = '';
  try {
    const cookies = await collectCookies();
    if (cookies.length === 0) {
      status.textContent = '未找到 Shopee 相关 Cookie，请先登录 seller.shopee.cn';
      status.className = 'err';
      return;
    }
    const payload = {
      savedAt: new Date().toISOString(),
      cookies: cookies.map(({ name, value, domain, path, expires, httpOnly, secure, sameSite }) => ({
        name, value, domain, path, expires, httpOnly, secure, sameSite,
      })),
    };
    status.textContent = `已读取 ${cookies.length} 个 Cookie，正在发送到本地工具...`;
    const resp = await fetch(SERVER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const text = await resp.text();
    if (resp.ok && text.includes('ok')) {
      status.textContent = '✓ 发送成功！';
      status.className = 'ok';
    } else {
      status.textContent = `发送失败（${resp.status}）：${text}。请先双击 启动.bat，再点此按钮`;
      status.className = 'err';
    }
  } catch (e) {
    status.textContent = `发送失败：${e.message}。请先双击 启动.bat 启动本地服务`;
    status.className = 'err';
  } finally {
    btn.disabled = false;
  }
});

document.getElementById('open').addEventListener('click', () => {
  chrome.tabs.create({ url: PAGE_URL });
});

// ============ 缓存清理 ============
// ext 为扩展自身缓存（chrome.storage.local + service worker 内存），本地直接清；
// 其余四类走本地服务 /api/cache/clear，服务端磁盘与内存一起清。
const CACHE_CATEGORIES = [
  { id: 'ext', name: '扩展凭证缓存', desc: '本扩展缓存待推送的凭证（清服务端凭证请用「视频上传凭证」）', confirm: '清空扩展缓存的凭证？下次抓取会自动重新保存。' },
  { id: 'video', name: '视频上传凭证', desc: '服务端凭证（跨境多店铺 + 本土），清后需重新抓取', confirm: '清空服务端的视频上传凭证？清后需重新在短视频页上传一次抓取。' },
  { id: 'bidding', name: '竞价登录 Cookie', desc: '竞价导出 / 取消竞价 / 取消 Hot Listing 共用', confirm: '清空竞价登录 Cookie？三个依赖它的工具都要重新点「发送登录信息」。' },
  { id: 'openapi', name: '开放平台店铺 Token', desc: '清后所有店铺需重新 OAuth 授权（App 配置保留）', confirm: '清空所有店铺的开放平台 Token？所有店铺都要重新授权，确定继续？' },
  { id: 'monitor', name: '监控大屏数据', desc: '告警记录 / 巡检快照 / 汇率缓存；阈值规则与店铺配置保留', confirm: '清空监控大屏数据？告警与历史快照不可恢复，确定继续？' },
];

const cacheStatusEl = document.getElementById('cacheStatus');
const cacheListEl = document.getElementById('cacheList');

function setCacheStatus(text, cls) {
  cacheStatusEl.textContent = text;
  cacheStatusEl.className = cls || '';
}

// 本地服务的缓存类别状态（GET /api/cache），ext 行单独从 chrome.storage 读
const cacheInfo = {};

async function loadExtInfo() {
  try {
    const r = await chrome.storage.local.get('credsBySite');
    const bySite = r && r.credsBySite ? r.credsBySite : {};
    let shops = 0;
    for (const c of Object.values(bySite)) {
      if (c && c.shops) shops += Object.keys(c.shops).length;
    }
    cacheInfo.ext = shops ? `缓存 ${Object.keys(bySite).length} 个站点 / ${shops} 个店铺凭证` : '无缓存';
  } catch {
    cacheInfo.ext = '';
  }
}

async function loadServerInfo() {
  for (const c of CACHE_CATEGORIES) {
    if (c.id === 'ext') continue;
    cacheInfo[c.id] = '';
  }
  try {
    const resp = await fetch(CACHE_URL, { method: 'GET' });
    const j = await resp.json();
    for (const c of (j && j.categories) || []) {
      const def = CACHE_CATEGORIES.find((x) => x.id === c.id);
      if (def) cacheInfo[c.id] = c.info || '';
    }
  } catch {
    for (const c of CACHE_CATEGORIES) {
      if (c.id !== 'ext') cacheInfo[c.id] = '本地服务未启动';
    }
  }
}

function renderCacheList() {
  cacheListEl.innerHTML = '';
  for (const c of CACHE_CATEGORIES) {
    const item = document.createElement('div');
    item.className = 'cache-item';

    const main = document.createElement('div');
    main.className = 'ci-main';
    const name = document.createElement('div');
    name.className = 'ci-name';
    name.textContent = c.name;
    const desc = document.createElement('div');
    desc.className = 'ci-desc';
    desc.textContent = c.desc;
    const info = document.createElement('div');
    info.className = 'ci-info';
    info.textContent = cacheInfo[c.id] || '';
    main.appendChild(name);
    main.appendChild(desc);
    main.appendChild(info);

    const btn = document.createElement('button');
    btn.className = 'ci-btn';
    btn.textContent = '清理';
    btn.addEventListener('click', () => clearCategory(c, btn));

    item.appendChild(main);
    item.appendChild(btn);
    cacheListEl.appendChild(item);
  }
}

async function clearCategory(c, btn) {
  if (!window.confirm(c.confirm)) return;
  btn.disabled = true;
  setCacheStatus(`正在清理「${c.name}」...`, '');
  try {
    if (c.id === 'ext') {
      const resp = await chrome.runtime.sendMessage({ type: 'clear-creds-cache' });
      if (resp && resp.ok) {
        setCacheStatus(`✅ 已清空「${c.name}」`, 'ok');
      } else {
        setCacheStatus(`清理「${c.name}」失败`, 'err');
      }
    } else {
      const resp = await fetch(CACHE_URL + '/clear', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category: c.id }),
      });
      const j = await resp.json().catch(() => null);
      if (resp.ok && j && j.ok) {
        setCacheStatus(`✅ ${j.message || `已清空「${c.name}」`}`, 'ok');
      } else {
        setCacheStatus(`清理「${c.name}」失败：${(j && j.message) || 'HTTP ' + resp.status}。请先双击 启动.bat 启动本地服务`, 'err');
      }
    }
  } catch (e) {
    setCacheStatus(`清理「${c.name}」失败：${e.message}。请先双击 启动.bat 启动本地服务`, 'err');
  } finally {
    btn.disabled = false;
    await refreshInfo();
  }
}

async function refreshInfo() {
  await Promise.all([loadExtInfo(), loadServerInfo()]);
  // 只更新各行的状态行，不整表重渲染（避免按钮焦点闪烁）
  const items = cacheListEl.querySelectorAll('.cache-item');
  CACHE_CATEGORIES.forEach((c, i) => {
    const infoEl = items[i] && items[i].querySelector('.ci-info');
    if (infoEl) infoEl.textContent = cacheInfo[c.id] || '';
  });
}

refreshInfo().then(renderCacheList);
