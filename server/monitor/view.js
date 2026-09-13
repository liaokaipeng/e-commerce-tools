'use strict';
// 大屏单店视图投影：把监控 meta 快照 + 规则定级组装成前端所需结构。
// 金额指标按全局展示模式换算展示、按人民币定级（阈值口径固定人民币）。
const { MATRIX_METRICS, isMoneyMetric } = require('./constants');
const { levelOf } = require('./rules');
const { toRmb, roundMoney } = require('./currency');
const store = require('./store');

/** 单店大屏数据：最新指标 + 矩阵定级（金额指标按全局模式换算展示、按人民币定级） */
function shopView(shopId, name) {
  const meta = store.getMeta();
  const m = (meta.shops && meta.shops[shopId]) || {};
  const latest = m.latest || {};
  const rulesById = store.getRulesById();
  const mode = store.getCurrencyMode();
  const currency = String(m.currency || 'CNY');
  const matrix = MATRIX_METRICS.map((metric) => {
    const p = latest[metric];
    const v = p && typeof p.v === 'number' ? p.v : null;
    const money = isMoneyMetric(metric);
    // 级别用人民币换算值比较（阈值口径固定人民币）；展示值按模式换算
    const { level } = levelOf(metric, money && v != null ? toRmb(v, currency) : v, rulesById);
    const display = money && v != null && mode === 'rmb' ? roundMoney(toRmb(v, currency)) : v;
    return { metric, v: display, at: p ? p.at : null, level };
  });
  return {
    shopId,
    name: name || m.name || '',
    lastRun: m.lastRun || {},
    failCount: m.failCount || {},
    consecutiveFails: m.consecutiveFails || 0,
    lastError: m.lastError || {},
    unsupported: m.unsupported || {},
    currency: currency,
    latest,
    matrix,
  };
}

module.exports = { shopView };
