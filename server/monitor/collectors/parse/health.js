'use strict';
// 账户健康域解析（纯函数）：履约指标、扣分、处罚、问题商品原因分布。
const { PUNISHMENT_TIER_NAMES, VIOLATION_REASON_NAMES } = require('../constants');

/** 账户健康归一化（纯函数）：metric_list 按 metric_name 取值，缺失记 null */
function normalizeHealth(json) {
  const out = { late_shipment_rate: null, non_fulfilment_rate: null, rating: null, penalty_points: null };
  const resp = json && json.response && typeof json.response === 'object' ? json.response : null;
  const ml = resp && Array.isArray(resp.metric_list) ? resp.metric_list : [];
  const num = (names) => {
    for (const name of names) {
      const m = ml.find((x) => x && x.metric_name === name);
      if (!m || m.current_period === null || m.current_period === undefined || m.current_period === '') continue;
      const n = Number(m.current_period);
      if (isFinite(n)) return n;
    }
    return null;
  };
  out.late_shipment_rate = num(['late_shipment_rate']);
  out.non_fulfilment_rate = num(['non_fulfillment_rate', 'non_fulfilment_rate']);
  out.rating = num(['shop_rating', 'rating']);
  const op = resp && resp.overall_performance;
  if (out.rating === null && op && op.rating !== undefined && op.rating !== '') {
    const n = Number(op.rating);
    if (isFinite(n)) out.rating = n;
  }
  return out;
}

/**
 * 处罚记录归一化（纯函数）：count = response.total_count（缺失回退 punishment_list 长度），
 * detail = 按 reason（1~5 即 Tier1~Tier5）聚合的级别分布。
 */
function normalizePunishments(json) {
  const resp = json && json.response && typeof json.response === 'object' ? json.response : null;
  const list = resp && Array.isArray(resp.punishment_list) ? resp.punishment_list : [];
  const total = resp && resp.total_count != null ? Number(resp.total_count) : NaN;
  const count = isFinite(total) ? total : list.length;
  const cnt = {};
  for (const p of list) {
    if (!p || typeof p !== 'object') continue;
    const name = PUNISHMENT_TIER_NAMES[p.reason] || (p.reason != null ? '类型' + p.reason : '未知');
    cnt[name] = (cnt[name] || 0) + 1;
  }
  const detail = Object.entries(cnt).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}×${v}`).join('/');
  return { count, detail };
}

/** 问题商品明细聚合（纯函数）：按 reason 中文分布 → 「违禁商品2/假冒商品1」 */
function violationBreakdown(list) {
  const cnt = {};
  for (const it of list || []) {
    if (!it || typeof it !== 'object' || it.reason == null) continue;
    const name = VIOLATION_REASON_NAMES[it.reason] || '其他(' + it.reason + ')';
    cnt[name] = (cnt[name] || 0) + 1;
  }
  return Object.entries(cnt).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}${v}`).join('/');
}

module.exports = { normalizeHealth, normalizePunishments, violationBreakdown };
