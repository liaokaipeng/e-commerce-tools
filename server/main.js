// 工具合集 - 单服务单端口（默认 8765）
// 合并了四个独立工具后端：
//   1) TikTok 无水印视频批量下载（原 8737）
//   2) Shopee 竞价导出（原 8765）
//   3) Shopee 取消竞价（待改进竞价批量撤销，与竞价导出共用 Cookie）
//   4) Shopee 视频批量上传（原 3000）
// 前端为门户页（frontend/dist，源码见 frontend/），通过 Tab 切换工具页面：
//   /tiktok/          TikTok 下载
//   /bidding/         Shopee 竞价导出
//   /bidding-cancel/  Shopee 取消竞价
//   /video/           Shopee 视频上传
// main.js 只负责「路由注册 + 静态服务 + 服务启动」，业务路由与 SSE 由各模块 register 提供。
const http = require('http');
const path = require('path');
const fs = require('fs');
const { sendJson, serveStatic, readBody } = require('./lib/http-utils');
const settings = require('./lib/settings');
const tiktok = require('./tiktok');
const bidding = require('./bidding');
const biddingCancel = require('./bidding-cancel');
const video = require('./video');

const PORT = process.env.PORT || 8765;
// 前端为 Vite 构建产物（frontend/dist），由 main.js 托管
const PUBLIC_DIR = path.join(__dirname, '..', 'frontend', 'dist');

// ============ 简易路由表 ============
const routes = [];
function get(p, fn) { routes.push({ m: 'GET', p, fn }); }
function post(p, fn) { routes.push({ m: 'POST', p, fn }); }

// 各业务模块注册自己的路由
tiktok.register({ get, post });
bidding.register({ get, post });
biddingCancel.register({ get, post });
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

// ============ 目录浏览（文件夹选择对话框用） ============
// GET /api/browse?path=<绝对路径>  列出该目录的子文件夹；path 为空时在 Windows 列出盘符
const isWin = process.platform === 'win32';

function listDirs(p) {
  return fs.readdirSync(p, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => ({ name: e.name, path: path.join(p, e.name) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function listDrives() {
  const drives = [];
  for (let i = 65; i <= 90; i++) {
    const letter = String.fromCharCode(i);
    try { fs.statSync(letter + ':\\'); drives.push({ name: letter + ':', path: letter + ':\\' }); }
    catch { /* 该盘符不存在 */ }
  }
  return drives;
}

get('/api/browse', (req, res, url) => {
  try {
    const p = (url.searchParams.get('path') || '').trim();
    if (!p) {
      sendJson(res, 200, {
        ok: true,
        current: null,
        parent: null,
        dirs: isWin ? listDrives() : listDirs('/'),
      });
      return;
    }
    if (!fs.statSync(p).isDirectory()) {
      sendJson(res, 400, { ok: false, message: '不是目录：' + p });
      return;
    }
    sendJson(res, 200, {
      ok: true,
      current: p,
      parent: path.dirname(p) === p ? null : path.dirname(p),
      dirs: listDirs(p),
    });
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
  console.log('  工具合集（Shopee：竞价导出 / 取消竞价 / 视频上传；TikTok：视频下载）');
  console.log('  请打开浏览器访问: http://127.0.0.1:' + PORT);
  console.log('==============================================');
  console.log('  - TikTok 下载     此页面即可直接使用');
  console.log('  - 竞价导出/取消竞价：需先装扩展并点「发送登录信息到本地工具」');
  console.log('  - 视频上传：需先装扩展，在短视频页手动上传一次视频抓取凭证');
  console.log('  扩展安装：edge://extensions → 开发人员模式 → 加载解压缩的扩展');
});