'use strict';
// 视频压缩链路常量（单一来源）：视频扩展名白名单、压缩目标默认值、ffmpeg 获取途径。
// 压缩靠外部 ffmpeg 可执行文件完成，不属于 Node 运行时依赖（见 AGENTS.md 约束 2）。

/** 参与压缩的视频扩展名（小写，含点）。avi/wmv/rmvb 等容器优先按其内容由 ffmpeg 识别 */
const VIDEO_EXT = new Set([
  '.mp4', '.m4v', '.mov', '.avi', '.mkv', '.flv', '.wmv', '.webm',
  '.mpg', '.mpeg', '.ts', '.mts', '.m2ts', '.3gp', '.3g2', '.rmvb', '.vob', '.f4v',
]);

/** 压缩目标默认值（前端可改，后端按请求体覆盖；用户需求即 30MB / 60 秒） */
const DEFAULTS = {
  maxMB: 30,          // 单个文件体积上限（MB）
  maxSeconds: 60,     // 单个文件时长上限（秒）
  overMode: 'trim',   // 超过时长上限时：trim=截取前 N 秒 | speed=整段加速到 N 秒
  maxLongSide: 1280,  // 长边上限（像素），0 = 不缩放；低码率下先缩分辨率比硬压糊更耐看
  outSubdir: 'compressed', // 未单独指定输出目录时，在源目录下建的子目录名
};

/** 压缩目标体积的可用比例：mp4 封装 + faststart 索引会占掉一点，留 4% 余量避免刚好越界 */
const SIZE_BUDGET = 0.96;

/** 音频码率（kbps）：太低会明显发闷，96k 立体声对 30MB/60s 的预算影响可忽略 */
const AUDIO_KBPS = 96;

/** 视频码率下限（kbps）：再低画面会糊成色块，不如让体积超标由前端提示 */
const MIN_VIDEO_KBPS = 150;

/** 体积仍超标时的重试次数，每轮把视频码率乘 RETRY_FACTOR 再编一次 */
const RETRY_TIMES = 2;
const RETRY_FACTOR = 0.82;

/** 跳过的目录名：产物目录自身（避免二次压缩）与常见系统目录 */
const SKIP_DIRS = new Set(['compressed', 'node_modules', '$RECYCLE.BIN', 'System Volume Information']);

/** 输出文件名后缀：与源文件区分，避免误覆盖 */
const OUT_SUFFIX = '_compressed';

/**
 * ffmpeg 获取途径（按顺序尝试，前一个失败就换下一个）。
 * GitHub 直连在国内常超时，故默认先走加速代理；gyan.dev 作最后兜底。
 * 均为「解压后含 bin/ffmpeg.exe 与 bin/ffprobe.exe」的官方/社区构建包。
 */
const FFMPEG_SOURCES = [
  {
    name: 'BtbN（加速代理）',
    url: 'https://gh-proxy.com/https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip',
  },
  {
    name: 'BtbN（加速代理 2）',
    url: 'https://ghproxy.net/https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip',
  },
  {
    name: 'gyan.dev（官方推荐）',
    url: 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip',
  },
  {
    name: 'BtbN（GitHub 直连）',
    url: 'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip',
  },
];

/** 解压后从包内提取的文件（相对包根的 bin/ 目录） */
const FFMPEG_FILES = ['ffmpeg.exe', 'ffprobe.exe'];

module.exports = {
  VIDEO_EXT,
  DEFAULTS,
  SIZE_BUDGET,
  AUDIO_KBPS,
  MIN_VIDEO_KBPS,
  RETRY_TIMES,
  RETRY_FACTOR,
  SKIP_DIRS,
  OUT_SUFFIX,
  FFMPEG_SOURCES,
  FFMPEG_FILES,
};
