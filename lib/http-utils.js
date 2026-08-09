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

// 目录路径 -> index.html 映射（门户 / 三个工具子页面）
const DIR_INDEX = {
  '/': '/index.html',
  '/tiktok/': '/tiktok/index.html',
  '/bidding/': '/bidding/index.html',
  '/video/': '/video/index.html',
};

/** 统一 JSON 响应 */
function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

/** 读取请求体（默认上限 2MB） */
function readBody(req, maxBytes = 2 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (c) => { body += c; if (body.length > maxBytes) req.destroy(); });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

/** 静态文件服务（含目录->index 映射与路径穿越防护） */
function serveStatic(res, urlPath, publicDir) {
  const fs = require('fs');
  const rel = DIR_INDEX[urlPath] || urlPath;
  const filePath = path.join(publicDir, rel);
  if (!filePath.startsWith(publicDir)) {
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

module.exports = { sendJson, readBody, serveStatic, MIME, DIR_INDEX };