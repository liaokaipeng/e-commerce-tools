'use strict';
// 时间窗与参数辅助（纯函数，便于单测）：把用户友好的写法换算成接口需要的秒级时间戳。
//   --last 7d / 24h / 30m / 90s / 纯数字(秒)   —— 相对当前时间往前推
//   --from / --to  支持 epoch 秒、13 位毫秒、ISO 日期时间、相对 -7d
//   --page-size N
// 只在用户未显式提供同名字段时注入；若已知该接口的参数表且不含该字段，则跳过并记提示，
// 避免给不接受该参数的接口硬塞 time_from 导致 error_param。
const UNIT_SEC = { s: 1, m: 60, h: 3600, d: 86400 };

/** '7d' / '24h' / '30m' / '90s' / 纯数字(秒) -> 秒数；非法返回 null */
function parseDuration(text) {
  const s = String(text == null ? '' : text).trim().toLowerCase();
  if (!s) return null;
  const m = s.match(/^(\d+(?:\.\d+)?)\s*([smhd]?)$/);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return null;
  const unit = m[2] || 's';
  return Math.round(n * UNIT_SEC[unit]);
}

/** 字符串是否形如相对时长（-7d / -24h），用于报错提示 */
function isRelative(text) {
  return /^-\d+(?:\.\d+)?[smhd]$/i.test(String(text == null ? '' : text).trim());
}

/**
 * 时间点 -> 秒级时间戳；非法返回 null。
 *   - 纯数字：>= 1e12 视为毫秒，否则视为 epoch 秒
 *   - 相对（-7d）：nowSec 往前推
 *   - 其它：交给 Date.parse（支持 2024-01-02 / 2024-01-02 03:04:05 / 带时区 ISO）
 */
function parseTimePoint(text, nowSec) {
  const raw = String(text == null ? '' : text).trim();
  if (!raw) return null;
  if (/^-?\d+$/.test(raw)) {
    const n = Number(raw);
    if (Math.abs(n) >= 1e12) return Math.floor(n / 1000);
    return n;
  }
  if (isRelative(raw)) {
    const d = parseDuration(raw.slice(1));
    if (d == null) return null;
    return Math.floor(nowSec - d);
  }
  const t = Date.parse(raw);
  if (!Number.isNaN(t)) return Math.floor(t / 1000);
  return null;
}

/**
 * 把 --page-size / --last / --from / --to 应用进业务参数。
 * @param {object} business 原始业务参数
 * @param {object} flags 解析出的命令行 flags
 * @param {string[]|null} known 该接口已知参数名（null 表示未知，不做跳过判断）
 * @param {number} nowSec 当前秒级时间戳
 * @returns {{ params: object, notes: string[] }}
 */
function applyHelpers(business, flags, known, nowSec) {
  const params = Object.assign({}, business || {});
  const notes = [];
  const knownSet = Array.isArray(known) ? new Set(known) : null;
  const hasVal = (k) => params[k] !== undefined && params[k] !== null && params[k] !== '';
  const inject = (name, val) => {
    if (hasVal(name)) return true;
    if (knownSet && !knownSet.has(name)) {
      notes.push(`接口参数表不含 ${name}，已跳过注入（如确需传请用 --param ${name}=...）`);
      return false;
    }
    params[name] = val;
    return true;
  };

  if (flags['page-size'] !== undefined && flags['page-size'] !== true) {
    const n = parseInt(flags['page-size'], 10);
    if (!Number.isFinite(n) || n <= 0) notes.push(`--page-size 非法（需正整数）：${flags['page-size']}`);
    else inject('page_size', n);
  }

  const hasFrom = flags.from !== undefined && flags.from !== true;
  const hasTo = flags.to !== undefined && flags.to !== true;
  const hasLast = flags.last !== undefined && flags.last !== true;

  let from = null;
  let to = null;
  if (hasFrom) {
    from = parseTimePoint(flags.from, nowSec);
    if (from == null) notes.push(`--from 无法解析（支持 epoch 秒 / ISO 日期 / -7d）：${flags.from}`);
  }
  if (hasTo) {
    to = parseTimePoint(flags.to, nowSec);
    if (to == null) notes.push(`--to 无法解析（支持 epoch 秒 / ISO 日期 / -7d）：${flags.to}`);
  }
  if (hasLast) {
    const d = parseDuration(flags.last);
    if (d == null) {
      notes.push(`--last 非法（示例：7d / 24h / 30m）：${flags.last}`);
    } else {
      const end = to == null ? nowSec : to;
      to = end;
      from = end - d;
    }
  }

  if (from != null) inject('time_from', from);
  if (to != null) inject('time_to', to);
  if ((from != null || to != null) && !hasVal('time_range_field')) {
    inject('time_range_field', 'create_time');
  }
  return { params, notes };
}

module.exports = { parseDuration, parseTimePoint, applyHelpers, isRelative };
