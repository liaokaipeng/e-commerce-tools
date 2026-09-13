// CORS 白名单：本工具只面向本机使用，除下列来源外一律拒绝跨源请求。
//   - http(s)://127.0.0.1|localhost[:任意端口]  本地页面 / Vite 开发服务器（5173）
//   - chrome-extension:// | moz-extension://    浏览器扩展（推送 Cookie / 凭证）
// 从 main.js 抽出为单一职责模块：主入口只调用 applyCors，不再内联判定与响应头处理。
function isAllowedOrigin(origin) {
  return /^(https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?|(chrome|moz|ms-browser)-extension:\/\/[a-z0-9]+)$/i.test(origin);
}

/**
 * 处理请求 CORS 头与预检：仅允许本机来源（浏览器扩展推送 + 本地页面跨端口调试）。
 * 收紧到白名单后，外部网页无法再向 127.0.0.1:8765 的写接口发跨源请求（防伪造凭证 CSRF 面）。
 * 扩展自身请求不带 Origin（或为 chrome-extension://）——无 Origin 时不写 CORS 头，
 * 同源与扩展侧均不受影响；非白名单来源直接回 403。
 * @param {object} req http.IncomingMessage
 * @param {object} res http.ServerResponse
 * @returns {boolean} 该请求已在此处理完毕（调用方应立即 return）
 */
function applyCors(req, res) {
  const origin = req.headers.origin || '';
  if (origin && !isAllowedOrigin(origin)) {
    res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: false, message: '来源不被允许' }));
    return true;
  }
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return true; }
  return false;
}

module.exports = { isAllowedOrigin, applyCors };
