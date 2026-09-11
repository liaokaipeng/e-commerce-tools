// TikTok 无水印视频下载模块（CommonJS）
// 由合并服务 main.js 引入，通过 register({ get, post }) 注册路由。
// 本文件只负责「路由注册」，链路编排拆分到 tiktok/ 子模块：
//   constants.js  常量与通用工具
//   proxy.js      代理检测与 agent 构造
//   request.js    出站 HTTPS 请求（重定向 / 中断）
//   parse.js      链接提取、页面解析（直连 + 第三方兜底）与文件下载
//   job.js        批量下载编排
'use strict';
const fs = require('fs');
const { execFile } = require('child_process');
const { sendJson, sse, readJsonBodySoft } = require('./lib/http-utils');
const { getDefault } = require('./lib/settings');
const { detectProxy } = require('./tiktok/proxy');
const { extractUrls } = require('./tiktok/parse');
const { runBatch } = require('./tiktok/job');

// ============ 路由处理（SSE 下载 / 状态 / 打开目录） ============

/** GET /api/tiktok/status */
function handleStatus(req, res) {
  sendJson(res, 200, {
    ok: true,
    proxy: detectProxy() || null,
    defaultDir: getDefault('tiktok'), // 未设置过时为 null，前端提示用户自选目录
    version: '1.0.0',
  });
}

/** POST /api/open-dir */
async function handleOpenDir(req, res) {
  try {
    const { dir } = await readJsonBodySoft(req, '/api/open-dir');
    const d = String(dir || '').trim();
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
}

/** POST /api/download（SSE 流式进度） */
async function handleDownload(req, res) {
  // 宽容解析（含 BOM 容忍）：请求体非法时按空对象处理，由下方 urls 校验回 400
  const payload = await readJsonBodySoft(req, '/api/download');
  const urls = extractUrls(payload.urls || '');
  const saveDir = String(payload.dir || '').trim();

  if (urls.length === 0) {
    sendJson(res, 400, { ok: false, message: '未识别到有效的 TikTok 链接，请检查输入（每行一个链接）' });
    return;
  }

  const emit = sse(res, { 'X-Accel-Buffering': 'no' });

  emit({ type: 'info', message: `共 ${urls.length} 个链接，开始下载...` });

  // 客户端断开（用户点击“停止下载”会 abort fetch）时，中止整个下载任务
  const controller = new AbortController();
  res.on('close', () => controller.abort());

  runBatch(urls, saveDir, emit, controller.signal).then(() => {
    try { res.end(); } catch { /* ignore */ }
  }).catch((e) => {
    if (controller.signal.aborted) return;
    emit({ type: 'fatal', message: `任务异常：${e.message}` });
    try { res.end(); } catch { /* ignore */ }
  });
}

/** 注册路由 */
function register({ get, post }) {
  get('/api/tiktok/status', handleStatus);
  post('/api/open-dir', handleOpenDir);
  post('/api/download', handleDownload);
}

module.exports = { register };
