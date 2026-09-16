// 视频压缩页的纯展示函数（无副作用、不依赖 Vue，便于单独测试）
const MB = 1024 * 1024;

/** 字节数 → 人类可读（与后端上报的字节数对齐，页面统一走这里而不是各自 toFixed） */
export function formatBytes(n) {
  const v = Number(n) || 0;
  if (v < 1024) return v + ' B';
  if (v < MB) return (v / 1024).toFixed(1) + ' KB';
  if (v < 1024 * MB) return (v / MB).toFixed(2) + ' MB';
  return (v / 1024 / MB).toFixed(2) + ' GB';
}

/** 秒 → m:ss（压缩后时长多为 60 秒整，用两位数秒更直观） */
export function formatDuration(sec) {
  const s = Math.max(0, Number(sec) || 0);
  const m = Math.floor(s / 60);
  const r = Math.round(s - m * 60);
  return `${m}:${String(r).padStart(2, '0')}`;
}

/** 体积压缩比文案（源 → 产物），跳过或数据缺失时返回空串 */
export function ratioText(before, after) {
  const b = Number(before) || 0;
  const a = Number(after) || 0;
  if (!b || !a) return '';
  return `-${Math.round((1 - a / b) * 100)}%`;
}

/**
 * 扫描结果汇总：给预览卡片顶部一行摘要用。
 * 体积按上限预判，时长要执行时用 ffprobe 才知道，故这里只提示体积维度。
 */
export function scanSummary(files, maxMB) {
  const list = Array.isArray(files) ? files : [];
  const maxBytes = (Number(maxMB) || 0) * MB;
  const totalSize = list.reduce((n, f) => n + (Number(f.size) || 0), 0);
  const overSize = list.filter((f) => f.size > maxBytes).length;
  return { count: list.length, totalSize, overSize };
}

/** 行状态 → el-tag 类型与文案（'' 等待 | run 进行中 | ok 已压缩 | skip 已达标 | err 失败） */
export const ROW_TAG = { '': 'info', run: 'warning', ok: 'success', skip: 'info', err: 'danger' };
export const ROW_TEXT = { '': '等待', run: '进行中', ok: '已压缩', skip: '已达标', err: '失败' };
