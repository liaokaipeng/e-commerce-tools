// 工具合集 - 单服务单端口（默认 8765）
// 合并了三个独立工具后端：
//   1) TikTok 无水印视频批量下载（原 8737）
//   2) Shopee 竞价导出（原 8765）
//   3) Shopee 视频批量上传（原 3000）
// 前端为门户页（public/index.html），通过 Tab 切换三个工具页面：
//   /tiktok/   TikTok 下载
//   /bidding/  Shopee 竞价导出
//   /video/    Shopee 视频上传
// main.js 只负责「路由注册 + 静态服务 + 服务启动」，业务路由与 SSE 由各模块 register 提供。
const http = require('http');
const path = require('path');
const { sendJson, serveStatic, readBody } = require('./lib/http-utils');
const settings = require('./lib/settings');
const tiktok = require('./tiktok');
const bidding = require('./bidding');
const video = require('./video');

const PORT = process.env.PORT || 8765;
const PUBLIC_DIR = path.join(__dirname, 'public');

// ============ 简易路由表 ============
const routes = [];
function get(p, fn) { routes.push({ m: 'GET', p, fn }); }
function post(p, fn) { routes.push({ m: 'POST', p, fn }); }

// 各业务模块注册自己的路由
tiktok.register({ get, post });
bidding.register({ get, post });
video.register({ get, post });

// ============ 工具默认目录（settings.json 持久化） ============
// GET  /api/settings            读取各工具默认目录
// POST /api/settings            设置某工具默认目录 { tool, dir }
get('/api/settings', (req, res) => {
  sendJson(res, 200, {
    ok: true,
    defaults: {
      tiktok: settings.getDefault('tiktok'),
      bidding: settings.getDefault('bidding'),
    },
  });
});

post('/api/settings', async (req, res) => {
  try {
    const { tool, dir } = JSON.parse(await readBody(req));
    if (tool !== 'tiktok' && tool !== 'bidding') {
      sendJson(res, 400, { ok: false, message: '无效的工具' });
      return;
    }
    const d = String(dir || '').trim();
    if (!d) {
      sendJson(res, 400, { ok: false, message: '目录不能为空' });
      return;
    }
    settings.setDefault(tool, d);
    sendJson(res, 200, { ok: true, dir: d });
  } catch (e) {
    sendJson(res, 400, { ok: false, message: e.message });
  }
});

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
    serveStatic(res, urlPath, PUBLIC_DIR);
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
  console.log('  工具合集（Shopee：竞价导出 / 视频上传；TikTok：视频下载）');
  console.log('  请打开浏览器访问: http://127.0.0.1:' + PORT);
  console.log('==============================================');
  console.log('  - TikTok 下载     此页面即可直接使用');
  console.log('  - 竞价导出：需先装扩展并点「发送登录信息到本地工具」');
  console.log('  - 视频上传：需先装扩展，在短视频页手动上传一次视频抓取凭证');
  console.log('  扩展安装：edge://extensions → 开发人员模式 → 加载解压缩的扩展');
});