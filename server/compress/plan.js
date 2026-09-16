'use strict';
/**
 * 压缩计划（纯函数，不碰文件系统与子进程）
 *
 * 给定源文件信息与压缩目标，算出「是否需要处理 / 输出时长 / 视频码率 / 缩放与变速滤镜」，
 * 由 run.js 据此拼 ffmpeg 命令行。拆成纯函数是为了能直接跑单元测试（见 test/unit/）。
 *
 * 码率算法：取「目标体积（留 SIZE_BUDGET 余量）× 8 ÷ 输出时长」与「源码率」中的较小者，
 * 减去音频码率即为视频码率。单遍 ABR 就够用；编完仍超标时由 run.js 降码率重试。
 * 之所以要跟源码率取小：只超时长、体积远低于上限的视频若按体积上限反推码率，
 * 会得到一个远高于源码率的值，重编码后体积不降反增（变速不增加信息量，沿用源码率即可）。
 */
const {
  DEFAULTS, SIZE_BUDGET, AUDIO_KBPS, MIN_VIDEO_KBPS, RETRY_FACTOR,
} = require('./constants');

const MB = 1024 * 1024;

/** 归一化前端传来的压缩选项（缺项 / 非法值回落到默认，避免 NaN 一路传到 ffmpeg） */
function normalizeOpts(raw = {}) {
  // 注意：null / 空串要按「未填写」处理。Number(null) === 0 且是有限数，若只判 isFinite
  // 会被夹到下限（maxSeconds 变 1 秒），把每个视频都截成 1 秒——比回落默认危险得多。
  const num = (v, def, min, max) => {
    if (v === null || v === undefined || v === '') return def;
    const n = Number(v);
    if (!Number.isFinite(n)) return def;
    return Math.min(max, Math.max(min, n));
  };
  return {
    maxMB: num(raw.maxMB, DEFAULTS.maxMB, 1, 4096),
    maxSeconds: num(raw.maxSeconds, DEFAULTS.maxSeconds, 1, 3600),
    maxLongSide: num(raw.maxLongSide, DEFAULTS.maxLongSide, 0, 7680),
  };
}

/** atempo 单次只能在 0.5~2 之间，超过 2 倍速需要级联多个 */
function atempoChain(ratio) {
  const parts = [];
  let x = ratio;
  while (x > 2) { parts.push('atempo=2'); x /= 2; }
  while (x < 0.5) { parts.push('atempo=0.5'); x /= 0.5; }
  parts.push('atempo=' + x.toFixed(4));
  return parts.join(',');
}

/** 长边超限时等比缩到上限（-2 保证另一维为偶数，h264 要求偶数尺寸） */
function scaleFilterFor(width, height, maxLongSide) {
  if (!maxLongSide) return '';
  const long = Math.max(width || 0, height || 0);
  if (!long || long <= maxLongSide) return '';
  return width >= height ? `scale=${maxLongSide}:-2` : `scale=-2:${maxLongSide}`;
}

/**
 * 生成压缩计划。
 * @param {{ size: number, duration: number, width: number, height: number, hasAudio: boolean }} info ffprobe 结果
 * @param {object} opts 已归一化的选项（normalizeOpts 输出）
 * @returns {object} { skip, reason, outDuration, outKbps, videoKbps, audioKbps, speedRatio,
 *                      scaleFilter, audioFilter, scale, hasAudio }
 */
function planFor(info, opts) {
  const maxBytes = opts.maxMB * MB;
  const sizeOk = info.size > 0 && info.size <= maxBytes;
  const timeOk = info.duration <= opts.maxSeconds;

  if (sizeOk && timeOk) {
    return { skip: true, reason: '已达标（体积与时长都在上限内）', outDuration: info.duration };
  }

  // 超出时长上限一律「整段加速到上限」（保留全部内容，不截取前 N 秒）
  const speedRatio = info.duration > opts.maxSeconds ? info.duration / opts.maxSeconds : 1;
  const outDuration = speedRatio > 1 ? opts.maxSeconds : Math.min(info.duration, opts.maxSeconds);

  const hasAudio = !!info.hasAudio;
  const audioKbps = hasAudio ? AUDIO_KBPS : 0;
  // 按预算反推的码率 + 源码率（体积 ÷ 时长 × 8），取小：源码率更低时照源码率编，
  // 避免「只超时长」的视频被硬塞一个远超源码率的码率而越压越大。
  const budgetKbps = (maxBytes * SIZE_BUDGET * 8) / outDuration / 1000;
  const srcKbps = info.size > 0 ? (info.size * 8) / info.duration / 1000 : Infinity;
  const totalKbps = Math.min(budgetKbps, srcKbps);
  const videoKbps = Math.max(MIN_VIDEO_KBPS, Math.floor(totalKbps - audioKbps));

  return {
    skip: false,
    reason: '',
    overSize: !sizeOk,
    overTime: !timeOk,
    outDuration,
    outKbps: Math.round(totalKbps),
    videoKbps,
    audioKbps,
    speedRatio,
    scaleFilter: scaleFilterFor(info.width, info.height, opts.maxLongSide),
    audioFilter: speedRatio > 1 ? atempoChain(speedRatio) : '',
    hasAudio,
  };
}

/** 体积仍超标时按 RETRY_FACTOR 降一档视频码率（不改时长与滤镜） */
function lowerBitrate(plan) {
  return Object.assign({}, plan, {
    videoKbps: Math.max(MIN_VIDEO_KBPS, Math.floor(plan.videoKbps * RETRY_FACTOR)),
  });
}

/**
 * 拼 ffmpeg 命令行参数（不含可执行文件本身）。
 * - `-t` 截断在输出侧，达到上限即停止解码，不需要先读完整文件；
 * - `-map 0:v:0` / `-map 0:a:0` 显式选主轨道，避免把封面图（mjpeg 静帧）当成视频轨；
 * - `-movflags +faststart` 把索引前置，保证平台侧边下边播；
 * - `-progress pipe:1` 让进度从 stdout 走，便于按文件上报百分比。
 */
function buildArgs({ input, output, plan }) {
  const args = [
    '-hide_banner', '-nostdin', '-y',
    '-progress', 'pipe:1', '-nostats',
    '-i', input,
    '-t', String(plan.outDuration),
    '-map', '0:v:0',
  ];
  if (plan.hasAudio) args.push('-map', '0:a:0');

  args.push('-c:v', 'libx264', '-preset', 'veryfast', '-profile:v', 'high', '-pix_fmt', 'yuv420p');
  args.push('-b:v', plan.videoKbps + 'k');
  args.push('-maxrate', Math.round(plan.videoKbps * 1.5) + 'k', '-bufsize', Math.round(plan.videoKbps * 2) + 'k');

  const vf = [];
  if (plan.speedRatio > 1) vf.push('setpts=PTS/' + plan.speedRatio.toFixed(6));
  if (plan.scaleFilter) vf.push(plan.scaleFilter);
  if (vf.length) args.push('-vf', vf.join(','));

  if (plan.hasAudio) {
    if (plan.audioFilter) args.push('-af', plan.audioFilter);
    args.push('-c:a', 'aac', '-b:a', plan.audioKbps + 'k', '-ac', '2');
  } else {
    args.push('-an');
  }

  args.push('-movflags', '+faststart', output);
  return args;
}

module.exports = { MB, normalizeOpts, planFor, lowerBitrate, buildArgs, atempoChain, scaleFilterFor };
