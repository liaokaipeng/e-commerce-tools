// 电商工具箱 - 单服务单端口（默认 8765）
// 合并了多个独立工具后端：
//   1) TikTok 无水印视频批量下载（原 8737）
//   2) Shopee 竞价导出（原 8765）
//   3) Shopee 取消竞价（待改进竞价批量撤销，与竞价导出共用 Cookie）
//   4) Shopee 视频批量上传（原 3000）
//   5) 视频压缩（本地文件夹递归压缩，依赖外部 ffmpeg）
// 前端为门户页（frontend/dist，源码见 frontend/），通过 Tab 切换工具页面：
//   /tiktok/          TikTok 下载
//   /bidding/         Shopee 竞价导出
//   /bidding-cancel/  Shopee 取消竞价
//   /hotlisting-cancel/  Shopee 取消注册 Hot Listing
//   /video/           Shopee 视频上传
//   /compress/        视频压缩
// main.js 只负责「路由注册 + 静态服务 + 服务启动」，业务路由与 SSE 由各模块 register 提供。
const http = require('http');
const path = require('path');
const { sendJson, serveStatic, createDispatcher } = require('./lib/http-utils');
const { isAllowedOrigin, applyCors } = require('./lib/cors');
const version = require('./lib/version');
const tiktok = require('./tiktok');
const bidding = require('./bidding');
const biddingCancel = require('./bidding-cancel');
const hotlistingCancel = require('./hotlisting-cancel');
const video = require('./video');
const openapi = require('./openapi');
const monitor = require('./monitor');
const compress = require('./compress');
const cache = require('./cache');
const update = require('./update');
const routesSettings = require('./routes/settings');
const routesBrowse = require('./routes/browse');

const { LISTEN_PORT: PORT, CALLBACK_PORT } = require('./lib/config');
// 前端为 Vite 构建产物（frontend/dist），由 main.js 托管
const PUBLIC_DIR = path.join(__dirname, '..', 'frontend', 'dist');

// 监听端口与 OAuth 回调端口不一致时，开放平台「自动回调」会失效：启动即显式提醒，避免静默失败。
if (String(PORT) !== String(CALLBACK_PORT)) {
  console.warn(`⚠️  当前监听端口为 ${PORT}，但开放平台 OAuth 回调固定为 ${CALLBACK_PORT}；`
    + '授权后将无法自动跳回本工具。请移除 PORT 环境变量使用默认端口。');
}

// ============ 简易路由表 ============
const routes = [];
function get(p, fn) { routes.push({ m: 'GET', p, fn }); }
function post(p, fn) { routes.push({ m: 'POST', p, fn }); }

// 各业务模块注册自己的路由
tiktok.register({ get, post });
bidding.register({ get, post });
biddingCancel.register({ get, post });
hotlistingCancel.register({ get, post });
video.register({ get, post });
openapi.register({ get, post });
monitor.register({ get, post });
compress.register({ get, post });
cache.register({ get, post });
update.register({ get, post });
// 工具默认目录设置（/api/settings）与目录浏览（/api/browse）分别由 routes/ 下单一职责模块注册
routesSettings.register({ get, post });
routesBrowse.register({ get, post });

// ============ HTTP 服务 ============
// CORS 白名单判定与请求头处理见 lib/cors.js（本机来源放行、外部来源 403）。

// 路由分发统一经 createDispatcher 包裹：处理器内未捕获的同步/异步异常兜底为 500，
// 不再让请求连接挂起（SSE 等已写响应头的连接不二次响应）。
const dispatch = createDispatcher(routes, (e, method, pathname) => {
  // 仅记录方法与路径 + 错误信息，不打印请求体（防凭证泄漏）
  console.error(`[路由错误] ${method} ${pathname}: ${e && e.message ? e.message : e}`);
});

// 只有直接运行 main.js（node server/main.js / 启动.bat）才监听端口；
// 被 require（单元测试验 isAllowedOrigin）时不启动服务。
const isMain = require.main === module;

const server = http.createServer((req, res) => {
  // CORS：仅允许本机来源（白名单判定与响应头处理见 lib/cors.js）。
  // 无 Origin（扩展 / 同源）不写 CORS 头；非白名单来源直接回 403。
  if (applyCors(req, res)) return;

  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const urlPath = url.pathname;

  if (dispatch(req, res, url)) return;

  if (req.method === 'GET') {
    serveStatic(res, urlPath, PUBLIC_DIR);
    return;
  }

  sendJson(res, 404, { ok: false, message: 'Not Found' });
});

server.on('error', (e) => {
  if (!isMain) return;
  if (e.code === 'EADDRINUSE') {
    console.error(`端口 ${PORT} 已被占用，可能已有服务在运行。请先关闭旧的黑色窗口后重试。`);
  } else {
    console.error('本地服务启动失败:', e.message);
  }
  process.exit(1);
});

if (isMain) {
  server.listen(PORT, '127.0.0.1', () => {
    console.log('==============================================');
    console.log('  电商工具箱（Shopee：竞价导出 / 取消竞价 / 取消Hot Listing / 视频上传；TikTok：视频下载；其他：视频压缩）');
    console.log('  版本 v' + version.currentVersion());
    console.log('  请打开浏览器访问: http://127.0.0.1:' + PORT);
    console.log('==============================================');
    console.log('  - TikTok 下载     此页面即可直接使用');
    console.log('  - 竞价导出/取消竞价/取消Hot Listing：需先装扩展并点「发送登录信息到工具」');
    console.log('  - 视频上传：需先装扩展，在短视频页手动上传一次视频抓取凭证');
    console.log('  - 开放平台：录入 App 后生成授权链接登录（回调 redirect 后台与本工具填一致，默认 https://example.com/，授权后粘贴回调链接完成）');
    console.log('  - 监控大屏：开放平台授权店铺后自动巡检采集，/monitor/ 查看三级告警大屏');
    console.log('  - 视频压缩：选文件夹后递归压缩（默认 ≤30MB / ≤60 秒），首次需点「下载并安装 ffmpeg」');
    console.log('  扩展安装：edge://extensions → 开发人员模式 → 加载解压缩的扩展');

    // 启动后自动检查更新（清单未配置时不产生定时器）
    update.startAutoCheck();
  });
}

module.exports = { isAllowedOrigin };