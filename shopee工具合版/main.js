// Shopee 工具合版 - 单服务单端口（默认 8765）
// 合并了三个独立工具后端：
//   1) TikTok 无水印视频批量下载（原 8737）
//   2) Shopee 竞价导出（原 8765）
//   3) Shopee 视频批量上传（原 3000）
// 前端为门户页（public/index.html），通过 Tab 切换三个工具页面：
//   /tiktok/   TikTok 下载
//   /bidding/  Shopee 竞价导出
//   /video/    Shopee 视频上传
const http = require('http');
const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');
const { runBatch, extractUrls, detectProxy } = require('./tiktok');
const bidding = require('./bidding');
const video = require('./video');

const PORT = process.env.PORT || 8765;
const PUBLIC_DIR = path.join(__dirname, 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

// ============ 简易路由表 ============
const routes = [];
function get(p, fn) { routes.push({ m: 'GET', p, fn }); }
function post(p, fn) { routes.push({ m: 'POST', p, fn }); }

function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (c) => { body += c; if (body.length > 2 * 1024 * 1024) req.destroy(); });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

// ============ 静态文件服务 ============
// 目录路径 -> index.html 映射（门户 / 三个工具子页面）
const DIR_INDEX = {
  '/': '/index.html',
  '/tiktok/': '/tiktok/index.html',
  '/bidding/': '/bidding/index.html',
  '/video/': '/video/index.html',
};

function serveStatic(req, res, urlPath) {
  const rel = DIR_INDEX[urlPath] || urlPath;
  const filePath = path.join(PUBLIC_DIR, rel);
  if (!filePath.startsWith(PUBLIC_DIR)) {
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

// ============ TikTok 下载路由 ============
get('/api/tiktok/status', (req, res) => {
  const defaultDir = process.env.USERPROFILE || process.env.HOME || __dirname;
  sendJson(res, 200, {
    ok: true,
    proxy: detectProxy() || null,
    defaultDir: path.join(defaultDir, 'Downloads', 'tiktok_videos'),
    version: '1.0.0',
  });
});

post('/api/open-dir', async (req, res) => {
  try {
    const { dir } = JSON.parse(await readBody(req));
    const d = (dir || '').trim();
    if (!d) {
      sendJson(res, 400, { ok: false, message: '请先填写保存目录' });
      return;
    }
    fs.mkdirSync(d, { recursive: true });
    execFile('cmd.exe', ['/c', 'start', '', d], { windowsHide: true }, () => {});
    sendJson(res, 200, { ok: true });
  } catch (e) {
    sendJson(res, 500, { ok: false, message: e.message });
  }
});

post('/api/download', async (req, res) => {
  let payload;
  try {
    const raw = (await readBody(req)).replace(/^\uFEFF/, '').trim();
    payload = JSON.parse(raw);
  } catch {
    sendJson(res, 400, { ok: false, message: '无效的请求体' });
    return;
  }
  const urls = extractUrls(payload.urls || '');
  const saveDir = (payload.dir || '').trim();

  if (urls.length === 0) {
    sendJson(res, 400, { ok: false, message: '未识别到有效的 TikTok 链接，请检查输入（每行一个链接）' });
    return;
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write('retry: 2000\n\n');

  const emit = (event) => {
    try { res.write(`data: ${JSON.stringify(event)}\n\n`); } catch { /* client gone */ }
  };

  emit({ type: 'info', message: `共 ${urls.length} 个链接，开始下载...` });

  runBatch(urls, saveDir, emit).then(() => {
    try { res.end(); } catch { /* ignore */ }
  }).catch((e) => {
    emit({ type: 'fatal', message: `任务异常：${e.message}` });
    try { res.end(); } catch { /* ignore */ }
  });
});

// ============ 注册各业务模块路由 ============
bidding.register({ get, post });
video.register({ get, post });

// ============ HTTP 服务 ============
const server = http.createServer((req, res) => {
  // CORS（扩展推送 / 跨源调试需要）
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const urlPath = url.pathname;

  const route = routes.find((r) => r.m === req.method && r.p === urlPath);
  if (route) {
    route.fn(req, res, url);
    return;
  }

  if (req.method === 'GET') {
    serveStatic(req, res, urlPath);
    return;
  }

  sendJson(res, 404, { ok: false, message: 'Not Found' });
});

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.error(`端口 ${PORT} 已被占用，可能已有服务在运行。请先关闭旧的黑色窗口后重试。`);
  } else {
    console.error('本地服务启动失败:', e.message);
  }
  process.exit(1);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('==============================================');
  console.log('  Shopee 工具合版（下载 / 竞价 / 上传）');
  console.log('  请打开浏览器访问: http://127.0.0.1:' + PORT);
  console.log('==============================================');
  console.log('  - TikTok 下载     此页面即可直接使用');
  console.log('  - 竞价导出：需先装扩展并点「发送登录信息到本地工具」');
  console.log('  - 视频上传：需先装扩展，在短视频页手动上传一次视频抓取凭证');
  console.log('  扩展安装：edge://extensions → 开发人员模式 → 加载解压缩的扩展');
});