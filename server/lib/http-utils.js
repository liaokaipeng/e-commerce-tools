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
  '/hotlisting-cancel/': '/hotlisting-cancel/index.html',
  '/product-export/': '/product-export/index.html',
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
 * 生成路由分发处理器：按「方法 + 路径」匹配路由表并调用处理函数；
 * 处理器内同步抛错或异步未捕获异常统一兜底为 500 响应，避免请求连接挂起。
 * @param {Array<{m: string, p: string, fn: Function}>} routes 路由表
 * @param {(err: Error, method: string, pathname: string) => void} [onError] 错误上报回调
 * @returns {(req: object, res: object, url: URL) => boolean} 命中路由返回 true，未命中返回 false
 */
function createDispatcher(routes, onError = () => {}) {
  return (req, res, url) => {
    const route = routes.find((r) => r.m === req.method && r.p === url.pathname);
    if (!route) return false;
    Promise.resolve()
      .then(() => route.fn(req, res, url))
      .catch((e) => {
        // SSE 等已写响应头的连接不再二次响应（客户端已接管流），仅记录错误
        if (!res.headersSent) sendJson(res, 500, { ok: false, message: '服务内部错误' });
        try { onError(e, req.method, url.pathname); } catch { /* 上报失败忽略 */ }
      });
    return true;
  };
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

/** 解析 JSON 文本：容忍 UTF-8 BOM（Windows 记事本/部分工具导出的文件带 BOM） */
function parseJsonText(text) {
  return JSON.parse(String(text || '').replace(/^\uFEFF/, ''));
}

/**
 * 读取并解析 JSON 请求体（严格）：请求体非法即抛错，由 createDispatcher 兜底为 500。
 * 供「请求体必须合法」的接口使用（monitor / openapi）。
 */
async function readJsonBody(req) {
  try {
    return parseJsonText(await readBody(req));
  } catch (e) {
    throw new Error('请求体不是合法 JSON：' + e.message);
  }
}

/**
 * 读取并解析 JSON 请求体（宽容）：解析失败只记一条 warn 并返回 {}，
 * 供「空请求体也应正常处理」的批量操作接口使用（由各路由自行判定缺字段并回 400）。
 * @param {string} label 日志中标识来源的接口路径（如 '/api/export'）
 */
async function readJsonBodySoft(req, label = '') {
  try {
    return parseJsonText(await readBody(req));
  } catch (e) {
    console.warn(`解析 ${label} 请求体失败:`, e.message);
    return {};
  }
}

/**
 * 读取路由请求体（宽容）：解析失败只记一条 warn 并返回 {}，
 * 供「空请求体也应正常处理」的批量操作接口使用（由各路由自行判定缺字段并回 400）。
 *
 * 传 ctx.res 时额外校验请求体 JSON 是否解析成功，失败回 400 —— 用于「把 body 当作必需
 * 控制指令」的接口（暂停 / 继续 / 取消），避免静默返回 {} 让调用方误判成参数缺失。
 * @param {object} req http.IncomingMessage
 * @param {string} label 日志中标识来源的接口路径（如 '/api/export'）
 * @param {object} [ctx] { res } 传入时解析失败自动回 400 并返回 null
 * @returns {Promise<object|null>} 解析结果（回 400 后为 null，调用方应直接 return）
 */
async function readRouteBody(req, label = '', ctx) {
  try {
    return parseJsonText(await readBody(req));
  } catch (e) {
    if (ctx && ctx.res) {
      sendJson(ctx.res, 400, { ok: false, msg: '请求体不是合法 JSON' });
      return null;
    }
    console.warn(`解析 ${label} 请求体失败:`, e.message);
    return {};
  }
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

module.exports = { sendJson, createDispatcher, sse, readBody, parseJsonText, readJsonBody, readJsonBodySoft, readRouteBody, serveStatic };