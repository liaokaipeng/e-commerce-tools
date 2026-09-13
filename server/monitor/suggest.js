'use strict';
// 阈值分位数建议（只读快照，不落盘、不自动应用）。
// 用途：默认阈值常与店铺实际量级不匹配（如「扣分记录数」恒为 1 却默认 p1=1 → 常驻 P1；
// 大店广告花费远超默认阈值 → 每轮必 P0）。这里按监控店铺的历史样本算分位数给「建议值」，
// 并给出「当前阈值历史命中率」，帮助判断阈值是否过于敏感；是否采纳完全由用户在规则面板决定。
const { METRICS } = require('./constants');
const { levelOf } = require('./rules');
const { toRmb } = require('./currency');
const store = require('./store');
const scheduler = require('./scheduler');

const SUGGEST_DAYS_DEFAULT = 30;
const SUGGEST_MIN_SAMPLES = 20;

/** 按指标单位取整建议值（百分比/评分/倍数保留 2 位，金额与计数取整） */
function roundByUnit(v, unit) {
  if (typeof v !== 'number' || !isFinite(v)) return null;
  if (unit === '%' || unit === '分' || unit === '倍') return Math.round(v * 100) / 100;
  return Math.round(v);
}

/** 升序数组的最近秩分位数（p 取 0~1） */
function percentile(sorted, p) {
  if (!sorted.length) return null;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * p)));
  return sorted[idx];
}

/** 逐规则计算历史样本（金额类先换算成人民币，与阈值比较口径一致），返回 { suggest, hitRate, flat } */
function buildRuleSuggestions(days) {
  const sched = scheduler.status();
  const monitored = sched.shops.filter((s) => s.monitored && !s.authBroken);
  const meta = store.getMeta();
  const rulesById = store.getRulesById();
  const out = {};
  for (const rule of store.getRules()) {
    if (rule.domain === 'system' || rule.type !== 'threshold') continue;
    const metric = rule.metric;
    const m = METRICS[metric] || {};
    const dir = m.direction || 'up';
    const unit = m.unit || '';
    const money = unit === '元';
    const samples = [];
    for (const s of monitored) {
      const cur = String((meta.shops && meta.shops[s.shopId] && meta.shops[s.shopId].currency) || 'CNY');
      for (const p of store.readTrend(s.shopId, metric, days)) {
        if (typeof p.v !== 'number' || !isFinite(p.v)) continue;
        samples.push(money ? toRmb(p.v, cur) : p.v);
      }
    }
    samples.sort((a, b) => a - b);
    const n = samples.length;
    // 当前阈值历史命中率（值落进任一触发级别即算命中；100% = 阈值过于敏感）
    let hit = 0;
    for (const v of samples) if (levelOf(metric, v, rulesById).level) hit += 1;
    const hitRate = n ? Math.round((hit / n) * 1000) / 10 : null;
    let suggest = null;
    let flat = false;
    if (n >= SUGGEST_MIN_SAMPLES) {
      // up（越大越差）：P75/P90/P97；down（越小越差）：P25/P10/P03
      const raw = dir === 'up'
        ? { p2: percentile(samples, 0.75), p1: percentile(samples, 0.9), p0: percentile(samples, 0.97) }
        : { p2: percentile(samples, 0.25), p1: percentile(samples, 0.1), p0: percentile(samples, 0.03) };
      suggest = { p2: roundByUnit(raw.p2, unit), p1: roundByUnit(raw.p1, unit), p0: roundByUnit(raw.p0, unit) };
      flat = suggest.p2 === suggest.p0;
      // up 方向建议落到 0 会把「值恒为 0」变成恒触发，视为样本不足，不给建议
      if (dir === 'up' && !(suggest.p2 > 0)) suggest = null;
    }
    out[rule.id] = { metric, unit, direction: dir, samples: n, hitRate, flat, suggest };
  }
  return { days, shops: monitored.length, suggest: out };
}

module.exports = { buildRuleSuggestions, SUGGEST_DAYS_DEFAULT };
