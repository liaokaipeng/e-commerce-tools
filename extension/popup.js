// 读取 Shopee 相关 Cookie（含 HttpOnly）并发送到本地工具（竞价导出用）
// 竞价接口只走 seller.shopee.cn，故仅收集 shopee.cn 域的 Cookie
const SERVER_URL = 'http://127.0.0.1:8765/api/cookie';
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
      status.textContent = '✅ 发送成功！请到本地网页（http://127.0.0.1:8765）「竞价导出」Tab 查看并导出。';
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