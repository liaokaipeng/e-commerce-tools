'use strict';
/**
 * 单文件压缩执行体：探测 → 算计划 → 跑 ffmpeg → 校验产物，超标则降码率重试。
 *
 * 四条硬约束：
 *   - **默认绝不写回源文件**：产物落在输出目录（留空即源文件同目录）并带 OUT_SUFFIX；
 *     只有显式 overwrite=true 时才覆盖原文件——两种模式都先写临时文件，原名只在最后改名那一刻被替换；
 *   - **可中断**：外部 shouldAbort() 为真时立刻 kill 掉 ffmpeg 子进程（否则取消要等整个视频编完）；
 *   - **产物必须复核**：ffmpeg 退出码为 0 不代表体积达标，编完一定重新 stat，超标就降档重来；
 *   - **失败不留半成品**：中断或报错时删掉写了一半的临时文件（覆盖模式下原文件全程未被触碰）。
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const { resolve } = require('./ffmpeg');
const { probe } = require('./probe');
const { normalizeOpts, planFor, lowerBitrate, buildArgs, MB } = require('./plan');
const { RETRY_TIMES, OUT_SUFFIX, TEMP_PREFIX } = require('./constants');

/** 取消/中断时抛出，调用方据此区别于「压缩失败」 */
class AbortedError extends Error {
  constructor(msg = '任务已取消') {
    super(msg);
    this.name = 'AbortedError';
  }
}

/** 产物文件名：源名去掉扩展名 + 后缀 + .mp4（统一转 mp4，便于平台侧识别） */
function outputName(sourceName) {
  const base = path.basename(sourceName, path.extname(sourceName));
  return base + OUT_SUFFIX + '.mp4';
}

/** 删除文件，失败不抛（文件可能被占用或本就不存在） */
function removeQuietly(file) {
  try { fs.rmSync(file, { force: true }); } catch { /* 删不掉也不该盖住真正的错误 */ }
}

/** 跑一次 ffmpeg；onProgress 收到 0~100，shouldAbort 为真时 kill 子进程 */
function runFfmpeg(args, { onProgress, shouldAbort }) {
  return new Promise((resolvePromise, reject) => {
    const st = resolve();
    if (!st.ready) return reject(new Error('未找到可用的 ffmpeg'));

    const child = spawn(st.ffmpeg, args, { windowsHide: true });
    let tail = [];
    let aborted = false;
    let outBuf = '';
    let lastEmit = 0;

    // 取消是异步到达的，ffmpeg 本身不会自己退出，只能轮询后 kill
    const timer = setInterval(() => {
      if (!aborted && shouldAbort && shouldAbort()) {
        aborted = true;
        try { child.kill(); } catch { /* 进程可能已退出 */ }
      }
    }, 200);

    child.stdout.on('data', (d) => {
      outBuf += d.toString('utf8');
      const lines = outBuf.split('\n');
      outBuf = lines.pop();
      for (const line of lines) {
        const m = /^out_time_(?:us|ms)=(\d+)/.exec(line.trim());
        if (!m || !onProgress) continue;
        const now = Date.now();
        if (now - lastEmit < 250) continue; // 限流，避免刷爆 SSE
        lastEmit = now;
        onProgress(Number(m[1]) / 1e6); // ffmpeg 该字段单位是微秒（字段名历史遗留，不是毫秒）
      }
    });

    child.stderr.on('data', (d) => {
      tail = tail.concat(d.toString('utf8').split('\n').filter((l) => l.trim()));
      if (tail.length > 20) tail = tail.slice(-20);
    });

    child.on('error', (e) => { clearInterval(timer); reject(new Error('无法启动 ffmpeg：' + e.message)); });
    child.on('close', (code) => {
      clearInterval(timer);
      if (aborted) return reject(new AbortedError());
      if (code !== 0) {
        return reject(new Error('ffmpeg 退出码 ' + code + '：' + tail.slice(-4).join(' | ')));
      }
      resolvePromise();
    });
  });
}

/**
 * 压缩单个视频。
 * @param {object} o
 * @param {string} o.input 源文件绝对路径
 * @param {string} o.outDir 输出目录（不存在自动创建；覆盖模式下即源文件所在目录）
 * @param {object} o.opts 压缩选项（原始值，内部会归一化）
 * @param {boolean} [o.overwrite] 是否用压缩结果直接覆盖原文件（默认 false，即另存为加后缀的新文件）
 * @param {(info: object) => void} [o.onProbe] 探测完成回调（上报时长/分辨率）
 * @param {(pct: number) => void} [o.onProgress] 进度回调（0~100）
 * @param {() => boolean} [o.shouldAbort] 中断判断
 * @returns {Promise<object>} 处理结果（含 skipped / overwritten / sizeBefore / sizeAfter / attempts 等）
 */
async function compressOne({ input, outDir, opts, overwrite = false, onProbe, onProgress, shouldAbort = () => false }) {
  const o = normalizeOpts(opts);
  if (shouldAbort()) throw new AbortedError();

  const info = probe(input);
  if (onProbe) onProbe(info);

  const plan = planFor(info, o);
  if (plan.skip) {
    return {
      skipped: true,
      reason: plan.reason,
      overwritten: false,
      sizeBefore: info.size,
      durationBefore: info.duration,
      outPath: null,
    };
  }

  fs.mkdirSync(outDir, { recursive: true });
  // 两种模式都先写临时文件再改名就位：ffmpeg 不能读写同一路径，覆盖模式更要保证原片
  // 完好到最后一刻（原名在改名那一刻才被替换；Node 的 rename 在 Windows 上会覆盖同名文件）。
  // 覆盖模式产物与源同名（统一转 mp4）；源本来就是 mp4（不分大小写）时直接沿用源的写法，
  // 免得 `.MP4` 的大小写差异被当成「另一个文件」而拒绝覆盖。
  const ext = path.extname(input);
  const base = path.basename(input, ext);
  const finalPath = path.join(outDir, overwrite
    ? (ext.toLowerCase() === '.mp4' ? base + ext : base + '.mp4')
    : outputName(input));
  const workPath = path.join(outDir, TEMP_PREFIX + process.pid + '-' + Date.now() + '.mp4');
  const maxBytes = o.maxMB * MB;

  let attempt = 0;
  let cur = plan;
  let size = 0;
  // 首次按算出的码率编；产物超标就降一档重来（最多 RETRY_TIMES 次）
  for (;;) {
    attempt += 1;
    if (shouldAbort()) {
      removeQuietly(workPath);
      throw new AbortedError();
    }
    const args = buildArgs({ input, output: workPath, plan: cur });
    try {
      await runFfmpeg(args, {
        shouldAbort,
        onProgress: (sec) => {
          if (!onProgress) return;
          const pct = Math.max(0, Math.min(100, Math.round((sec / plan.outDuration) * 100)));
          onProgress(pct);
        },
      });
    } catch (e) {
      // 中断或报错时 ffmpeg 已经写了一个不完整的文件：留着会被误当成成品，直接删掉
      removeQuietly(workPath);
      throw e;
    }

    size = fs.existsSync(workPath) ? fs.statSync(workPath).size : 0;
    if (size > 0 && size <= maxBytes) break;
    if (attempt > RETRY_TIMES) break; // 降到底仍超标，如实上报，不再无限重试
    cur = lowerBitrate(cur);
  }

  // 就位：覆盖模式只在产物确实更小、且不会顶掉别人的同名 mp4 时才替换原片；
  // 否则保留原文件并说明原因（绝不用更大的文件盖掉原片）。
  const samePath = path.resolve(finalPath) === path.resolve(input);
  const blocked = overwrite && !samePath && fs.existsSync(finalPath);
  const smaller = size > 0 && size < info.size;
  let overwritten = false;
  let reason = '';
  if (overwrite && (blocked || !smaller)) {
    removeQuietly(workPath);
    reason = blocked ? '同名 mp4 已存在，已保留原文件' : '压缩后未变小，已保留原文件';
  } else {
    try {
      fs.renameSync(workPath, finalPath);
    } catch (e) {
      removeQuietly(workPath);
      throw new Error('写入产物失败（文件可能被占用）：' + e.message);
    }
    if (overwrite) {
      overwritten = true;
      if (!samePath) removeQuietly(input); // 源是别的扩展名（如 .mov）：产物就位后再删原片
    }
  }
  const outPath = overwrite && !overwritten ? null : finalPath;
  const kept = overwrite && !overwritten;

  // 产物复核：以实际文件为准，ffmpeg 报的时长在高倍速场景下会有零点几秒偏差
  let outInfo = null;
  if (outPath) {
    try { outInfo = probe(outPath); } catch { /* 探测失败不影响主流程，前端按文件大小判断 */ }
  }

  return {
    skipped: false,
    overwritten,
    reason,
    outPath,
    attempts: attempt,
    sizeBefore: info.size,
    sizeAfter: kept ? info.size : size,
    producedSize: size, // 本次编出来的大小（覆盖被拒时用它说明「压出来反而更大」）
    durationBefore: info.duration,
    durationAfter: kept ? info.duration : (outInfo ? outInfo.duration : plan.outDuration),
    width: info.width,
    height: info.height,
    overSize: !!plan.overSize,
    overTime: !!plan.overTime,
    speedRatio: plan.speedRatio,
    targetKbps: cur.videoKbps,
    withinLimit: kept ? true : size <= maxBytes,
  };
}

module.exports = { compressOne, AbortedError, outputName };
