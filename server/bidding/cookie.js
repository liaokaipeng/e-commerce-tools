'use strict';
// 扩展 Cookie 接收与登录状态：session 文件路径与读取统一走 lib/shopee-session.js。
const fs = require('fs');
const path = require('path');
const { readJsonBodySoft } = require('../lib/http-utils');
const { SESSION_FILE, readSession } = require('../lib/shopee-session');

// 注意：本接口是扩展（extension/popup.js）的对接协议，返回纯文本 'ok' / 错误说明，
// 与其余接口的 JSON 风格不同，改动需同步扩展判断逻辑。
async function handleCookie(req, res) {
  const payload = await readJsonBodySoft(req, '/api/cookie');
  const cookies = Array.isArray(payload.cookies) ? payload.cookies : [];
  if (!cookies.length) {
    res.writeHead(400, { 'Content-Type': 'text/plain' });
    res.end('no cookies');
    return;
  }
  try {
    fs.mkdirSync(path.dirname(SESSION_FILE), { recursive: true });
    fs.writeFileSync(SESSION_FILE, JSON.stringify(payload, null, 2));
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('ok');
    console.log(`✅ 已收到 ${cookies.length} 个 Cookie，保存到 ${SESSION_FILE}`);
  } catch (e) {
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('save failed: ' + e.message);
  }
}

/** 当前登录状态（/api/status 用） */
function sessionStatus() {
  const session = readSession();
  return {
    loggedIn: !!(session && session.cookies && session.cookies.length),
    cookieCount: session?.cookies?.length || 0,
    savedAt: session?.savedAt || null,
  };
}

module.exports = { handleCookie, sessionStatus };
