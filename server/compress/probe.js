'use strict';
/**
 * 媒体信息探测：用 ffprobe 读时长 / 分辨率 / 编码，供压缩计划（plan.js）算目标码率。
 *
 * 读不到时长等关键信息时抛错，由上层记为「该文件跳过并给出原因」——
 * 宁可如实报告，也不要拿默认值猜一个码率硬压（会产出体积或时长都不达标的文件）。
 */
const { spawnSync } = require('child_process');

const { resolve } = require('./ffmpeg');

/** ffprobe 的超时（毫秒）：单个文件读元数据，超时说明文件异常或磁盘卡死 */
const TIMEOUT_MS = 30000;

/** 从 side_data / tags 里取旋转角度（手机竖屏视频靠它决定实际宽高） */
function rotationOf(stream) {
  const list = stream.side_data_list || [];
  for (const sd of list) {
    if (sd.rotation !== undefined && sd.rotation !== null) {
      const n = Number(sd.rotation);
      if (Number.isFinite(n)) return n;
    }
  }
  const t = Number(stream.tags && stream.tags.rotate);
  return Number.isFinite(t) ? t : 0;
}

/**
 * 读取媒体信息。
 * @param {string} file 视频文件绝对路径
 * @returns {{ duration: number, size: number, width: number, height: number,
 *             videoCodec: string, audioCodec: string|null, hasAudio: boolean }}
 */
function probe(file) {
  const st = resolve();
  if (!st.ready) throw new Error('未找到可用的 ffprobe，请先在页面上完成 ffmpeg 安装');

  const r = spawnSync(st.ffprobe, [
    '-v', 'error',
    '-print_format', 'json',
    '-show_format',
    '-show_streams',
    file,
  ], { encoding: 'utf8', timeout: TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024 });

  if (r.error) throw new Error('ffprobe 执行失败：' + r.error.message);
  if (r.status !== 0) {
    const msg = String(r.stderr || '').trim().split('\n').slice(-3).join(' ');
    throw new Error('无法解析该文件（可能不是有效视频）：' + (msg || `ffprobe 退出码 ${r.status}`));
  }

  let data;
  try {
    data = JSON.parse(r.stdout);
  } catch {
    throw new Error('ffprobe 输出无法解析');
  }

  const streams = data.streams || [];
  const v = streams.find((s) => s.codec_type === 'video');
  if (!v) throw new Error('该文件不含视频轨道');
  const a = streams.find((s) => s.codec_type === 'audio');

  const fmt = data.format || {};
  const duration = Number(fmt.duration || v.duration || 0);
  if (!Number.isFinite(duration) || duration <= 0) throw new Error('无法读取视频时长');
  const size = Number(fmt.size || 0);

  // 旋转 90/270 度时实际显示宽高互换（ffmpeg 播放时会自动应用旋转）
  const rot = Math.abs(rotationOf(v)) % 180;
  const swap = rot === 90;
  const width = swap ? Number(v.height || 0) : Number(v.width || 0);
  const height = swap ? Number(v.width || 0) : Number(v.height || 0);

  return {
    duration,
    size,
    width,
    height,
    videoCodec: v.codec_name || '',
    audioCodec: a ? a.codec_name || '' : null,
    hasAudio: !!a,
  };
}

module.exports = { probe };
