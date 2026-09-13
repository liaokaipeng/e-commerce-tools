'use strict';
// 快照持久化：按天分文件的采样数组，append 采样 + 趋势读取 + 过期清理。
const fs = require('fs');
const path = require('path');
const { ymd } = require('../../lib/date-utils');
const { RETENTION_DAYS, SNAPSHOT_CAP_PER_DAY } = require('../constants');
const { SNAPSHOT_DIR } = require('./paths');

/** 追加一条采样 { at, v }；自动按天分文件并清理超过保留期的旧文件 */
function appendSample(shopId, metric, v, at) {
  if (typeof v !== 'number' || !isFinite(v)) return;
  const dir = path.join(SNAPSHOT_DIR, String(shopId), String(metric));
  const file = path.join(dir, ymd(at) + '.json');
  try {
    fs.mkdirSync(dir, { recursive: true });
    let arr = [];
    if (fs.existsSync(file)) {
      arr = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (!Array.isArray(arr)) arr = [];
    }
    arr.push({ at, v });
    if (arr.length > SNAPSHOT_CAP_PER_DAY) arr.splice(0, arr.length - SNAPSHOT_CAP_PER_DAY);
    fs.writeFileSync(file, JSON.stringify(arr));
    // 顺带清理过期快照（同目录下超过保留期的天文件）
    const cutoff = Date.now() - RETENTION_DAYS * 24 * 3600 * 1000;
    for (const f of fs.readdirSync(dir)) {
      if (!/^\d{4}-\d{2}-\d{2}\.json$/.test(f)) continue;
      if (new Date(f.slice(0, 10)).getTime() < cutoff) {
        try { fs.unlinkSync(path.join(dir, f)); } catch { /* 忽略 */ }
      }
    }
  } catch (e) {
    console.warn('[监控] 写快照失败（' + shopId + '/' + metric + '）:', e.message);
  }
}

/**
 * 读取采样点，按时间升序。
 * @param {number} days 窗口天数（含今天）
 * @param {number} [offsetDays] 窗口后移天数：0=最近窗口，days=上一周期窗口（环比对比用）
 */
function readTrend(shopId, metric, days, offsetDays) {
  const dir = path.join(SNAPSHOT_DIR, String(shopId), String(metric));
  const points = [];
  try {
    if (!fs.existsSync(dir)) return points;
    const names = fs.readdirSync(dir).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
    const win = Math.max(1, days || 7);
    const off = Math.max(0, offsetDays || 0);
    // offsetDays=0 取最近 win 天；否则取「更早的 win 天」（避免与当前窗口重叠）
    const keep = off ? names.slice(-(win + off), -off) : names.slice(-win);
    for (const f of keep) {
      const arr = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      if (Array.isArray(arr)) for (const p of arr) if (p && typeof p.v === 'number') points.push({ at: p.at, v: p.v });
    }
  } catch (e) {
    console.warn('[监控] 读趋势失败（' + shopId + '/' + metric + '）:', e.message);
  }
  points.sort((a, b) => a.at - b.at);
  return points;
}

module.exports = { appendSample, readTrend };
