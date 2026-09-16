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

/** 体积变化文案（源 → 产物）：缩小显示 -N%，反而变大显示 +N%（变大属异常，必须一眼看出来） */
export function ratioText(before, after) {
  const b = Number(before) || 0;
  const a = Number(after) || 0;
  if (!b || !a) return '';
  const pct = Math.round((1 - a / b) * 100);
  return pct >= 0 ? `-${pct}%` : `+${-pct}%`;
}

/**
 * 行状态 → el-tag 类型与文案（'' 等待 | run 进行中 | ok 已压缩 | skip 已达标 | err 失败）
 */
export const ROW_TAG = { '': 'info', run: 'warning', ok: 'success', skip: 'info', err: 'danger' };
export const ROW_TEXT = { '': '等待', run: '进行中', ok: '已压缩', skip: '已达标', err: '失败' };
