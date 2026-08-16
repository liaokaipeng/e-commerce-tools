// 通用 HTTP 工具：JSON 响应 / 请求体读取 / 静态文件服务
// 供 main.js 与各业务模块共用，避免重复实现。
const path = require('path');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

// 目录路径 -> index.html 映射（门户 / 工具子页面）
const DIR_INDEX = {
  '/': '/index.html',
  '/tiktok/': '/tiktok/index.html',
  '/bidding/': '/bidding/index.html',
  '/bidding-cancel/': '/bidding-cancel/index.html',
  '/video/': '/video/index.html',
  '/openapi/': '/openapi/index.html',
  '/monitor/': '/monitor/index.html',
};

/** 统一 JSON 响应 */
function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

/**
 * 初始化 SSE 响应（写响应头 + retry），返回向该连接写事件的 emit 函数。
 * 供各业务模块的流式进度接口复用，避免重复写响应头与 emit 封装。
 * @param {object} res http.ServerResponse
 * @param {object} [extraHeaders] 额外响应头（如 X-Accel-Buffering / CORS）
 * @returns {(data: object) => void}
 */
function sse(res, extraHeaders = {}) {
  res.writeHead(200, Object.assign({
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  }, extraHeaders));
  res.write('retry: 2000\n\n');
  return (data) => {
    try { res.write(`data: ${JSON.stringify(data)}\n\n`); } catch { /* client gone */ }
  };
}

/** 读取请求体（默认上限 2MB）：按字节计数，超限直接拒绝而非静默截断 */
function readBody(req, maxBytes = 2 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let done = false;
    req.on('data', (c) => {
      size += c.length;
      if (size > maxBytes) {
        done = true;
        reject(new Error('请求体超过大小限制'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => { if (!done) resolve(Buffer.concat(chunks).toString('utf8')); });
    req.on('error', (e) => { if (!done) { done = true; reject(e); } });
  });
}

/** 静态文件服务（含目录->index 映射与路径穿越防护） */
function serveStatic(res, urlPath, publicDir) {
  const fs = require('fs');
  const rel = DIR_INDEX[urlPath] || urlPath;
  const filePath = path.join(publicDir, rel);
  // 用相对路径判断是否越出根目录，避免前缀近似（如 /dist-evil）绕过 startsWith 校验
  const relCheck = path.relative(publicDir, filePath);
  if (relCheck.startsWith('..') || path.isAbsolute(relCheck)) {
    res.writeHead(403); res.end('Forbidden');
    return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404 Not Found');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

module.exports = { sendJson, sse, readBody, serveStatic };