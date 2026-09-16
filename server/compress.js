'use strict';
/**
 * 视频压缩模块（CommonJS）
 *
 * 由合并服务 main.js 引入，通过 register({ get, post }) 注册路由。
 * 本文件只负责「路由注册与入参校验」，链路拆分到 compress/ 子模块：
 *   constants.js  视频扩展名 / 压缩目标默认值 / ffmpeg 下载源
 *   ffmpeg.js     ffmpeg 与 ffprobe 的定位、版本探测、一键下载安装
 *   probe.js      ffprobe 读时长 / 分辨率 / 编码
 *   scan.js       递归找视频文件
 *   plan.js       纯函数：达标判定、码率与滤镜计算、命令行拼装
 *   run.js        单文件压缩执行（含降码率重试与中断 kill）
 *   job.js        批量编排（SSE）与单飞互斥
 *
 * 压缩靠外部 ffmpeg 完成，不是 Node 运行时依赖；它落在仓库根 bin/（gitignored），
 * 既不进发布包也不被一键更新覆盖。
 */
const fs = require('fs');
const path = require('path');

const { sendJson, sse, readJsonBodySoft } = require('./lib/http-utils');
const jobs = require('./lib/jobs');
const { DEFAULTS } = require('./compress/constants');
const ffmpeg = require('./compress/ffmpeg');
const { scanVideos, MAX_FILES } = require('./compress/scan');
const { normalizeOpts } = require('./compress/plan');
const { runBatch, isRunning } = require('./compress/job');

const MB = 1024 * 1024;

/**
 * 校验并归一化前端传来的文件夹路径。
 * 统一在入口处判定存在性，避免 fs 的原始报错（ENOENT / EPERM）直接漏给用户。
 * @returns {{ ok: true, dir: string } | { ok: false, message: string }}
 */
function checkDir(raw) {
  const dir = String(raw || '').trim();
  if (!dir) return { ok: false, message: '请先选择要压缩的文件夹' };
  try {
    if (!fs.statSync(dir).isDirectory()) return { ok: false, message: '不是文件夹：' + dir };
  } catch {
    return { ok: false, message: '文件夹不存在或无法访问：' + dir };
  }
  return { ok: true, dir };
}

/** GET /api/compress/status：ffmpeg 可用性 + 压缩默认值 + 是否已有任务在跑 */
function handleStatus(req, res) {
  const st = ffmpeg.resolve();
  sendJson(res, 200, {
    ok: true,
    ffmpeg: {
      ready: st.ready,
      version: st.version,
      ffmpegPath: st.ffmpeg,
      ffprobePath: st.ffprobe,
      binDir: ffmpeg.binDir(),
    },
    defaults: DEFAULTS,
    running: isRunning(),
    maxFiles: MAX_FILES,
  });
}

/** POST /api/compress/install-ffmpeg（SSE 流式下载进度） */
async function handleInstall(req, res) {
  if (isRunning()) {
    sendJson(res, 409, { ok: false, message: '正在执行压缩任务，请等任务结束后再安装 ffmpeg' });
    return;
  }
  const emit = sse(res, { 'X-Accel-Buffering': 'no' });
  let clientGone = false;
  res.on('close', () => { clientGone = true; });

  try {
    const r = await ffmpeg.install(
      (ev) => emit(Object.assign({ type: 'install' }, ev)),
      () => clientGone,
    );
    emit({ type: 'installed', version: r.version, source: r.source, path: r.ffmpeg });
  } catch (e) {
    emit({ type: 'fatal', msg: clientGone ? '安装已中断' : '安装 ffmpeg 失败：' + e.message });
  }
  try { res.end(); } catch { /* 连接可能已断开 */ }
}

/** POST /api/compress/scan：递归列出视频文件（不探测时长，保持秒回） */
async function handleScan(req, res) {
  try {
    const body = await readJsonBodySoft(req, '/api/compress/scan');
    const checked = checkDir(body.dir);
    if (!checked.ok) {
      sendJson(res, 400, { ok: false, message: checked.message });
      return;
    }
    const opts = normalizeOpts(body.opts);
    const result = scanVideos(checked.dir);
    const maxBytes = opts.maxMB * MB;
    sendJson(res, 200, {
      ok: true,
      root: result.root,
      totalSize: result.totalSize,
      truncated: result.truncated,
      emptyDirs: result.emptyDirs,
      // 只按体积预判「需不需要处理」：时长要等执行时用 ffprobe 读，扫描阶段不逐文件探测
      files: result.files.map((f) => ({
        rel: f.rel,
        name: f.name,
        size: f.size,
        overSize: f.size > maxBytes,
      })),
    });
  } catch (e) {
    sendJson(res, 400, { ok: false, message: e.message });
  }
}

/** POST /api/compress/run（SSE 流式进度） */
async function handleRun(req, res) {
  const body = await readJsonBodySoft(req, '/api/compress/run');
  const opts = normalizeOpts(body.opts);

  const checked = checkDir(body.dir);
  if (!checked.ok) {
    sendJson(res, 400, { ok: false, message: checked.message });
    return;
  }
  if (!ffmpeg.resolve().ready) {
    sendJson(res, 400, { ok: false, message: '尚未安装 ffmpeg，请先在页面上点「下载并安装 ffmpeg」' });
    return;
  }
  if (isRunning()) {
    sendJson(res, 409, { ok: false, message: '已有压缩任务在执行，请等它结束或先取消' });
    return;
  }

  let scanned;
  try {
    scanned = scanVideos(checked.dir);
  } catch (e) {
    sendJson(res, 400, { ok: false, message: '扫描文件夹失败：' + e.message });
    return;
  }
  if (!scanned.files.length) {
    sendJson(res, 400, { ok: false, message: '该文件夹（含子目录）里没有找到视频文件' });
    return;
  }

  // 输出位置：留空 = 与源文件同目录（产物加后缀区分，绝不覆盖源文件）；指定目录则保持相对层级。
  // 覆盖模式（overwrite）忽略输出目录，直接写回源文件（由 run.js 先写临时文件、复核后再替换）。
  const overwrite = !!body.overwrite;
  const customOutDir = String(body.outDir || '').trim();
  if (!overwrite && customOutDir) {
    try {
      fs.mkdirSync(customOutDir, { recursive: true });
    } catch (e) {
      sendJson(res, 400, { ok: false, message: '无法创建输出目录：' + e.message });
      return;
    }
  }

  const files = scanned.files.map((f) => {
    let outDir;
    if (overwrite || !customOutDir) {
      outDir = path.dirname(f.path); // 留空 / 覆盖：与源文件同目录
    } else {
      // 指定输出目录时保持源目录的相对层级，避免不同子目录里的同名文件互相覆盖
      const sub = path.dirname(f.rel);
      outDir = sub && sub !== '.' ? path.join(customOutDir, sub) : customOutDir;
    }
    return Object.assign({}, f, { outDir, overwrite });
  });

  const outDirShown = overwrite || !customOutDir ? scanned.root : customOutDir;
  runBatch(res, { files, root: scanned.root, outDir: outDirShown, opts });
}

/** 注册路由 */
function register({ get, post }) {
  get('/api/compress/status', handleStatus);
  post('/api/compress/install-ffmpeg', handleInstall);
  post('/api/compress/scan', handleScan);
  post('/api/compress/run', handleRun);
  // 暂停 / 继续 / 取消三件套（与取消竞价、视频上传共用同一实现）
  jobs.registerControlRoutes(post, '/api/compress');
}

module.exports = { register };
