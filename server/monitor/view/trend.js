'use strict';
// 指标趋势视图：采样点 + 阈值（画参考线用）的查询与金额换算。
// 金额模式换算与阈值反向换算集中在此（阈值口径固定人民币，展示按当前模式换算）。
const { METRICS, isMoneyMetric } = require('../constants');
const { toRmb, fromRmb, roundMoney, symbolOf } = require('../currency');
const store = require('../store');

/**
 * 组装趋势响应体（?shopId=&metric=&days=7&compare=1）。
 * compare=1 时额外返回上一周期（更早 days 天）采样点，供大屏画环比对比线。
 * @param {string} shopId
 * @param {string} metric
 * @param {number} days
 * @param {boolean} compare
 * @returns {object} 响应体
 */
function buildTrendPayload(shopId, metric, days, compare) {
  const m = METRICS[metric];
  const rule = store.getRulesById()[metric];
  const meta = store.getMeta();
  const shopMeta = (meta.shops && meta.shops[shopId]) || {};
  const currency = String(shopMeta.currency || 'CNY');
  const mode = store.getCurrencyMode();
  let points = store.readTrend(shopId, metric, days);
  let prevPoints = compare ? store.readTrend(shopId, metric, days, days) : [];
  let thresholds = (rule && rule.thresholds) || null;
  let unit = (m || {}).unit || '';
  if (isMoneyMetric(metric)) {
    if (mode === 'rmb') {
      const toRmbPoints = (arr) => arr.map((p) => ({ at: p.at, v: roundMoney(toRmb(p.v, currency)) }));
      points = toRmbPoints(points);
      prevPoints = toRmbPoints(prevPoints);
    } else {
      // 当地货币展示：阈值参考线同步换算成当地金额（阈值口径固定人民币）
      unit = symbolOf(currency);
      if (thresholds) {
        const th = {};
        for (const [k, v] of Object.entries(thresholds)) {
          if (typeof v === 'number') th[k] = roundMoney(fromRmb(v, currency));
        }
        thresholds = th;
      }
    }
  }
  return {
    ok: true,
    metric: Object.assign({}, m || {}, { id: metric, unit }),
    thresholds,
    points,
    prevPoints,
  };
}

module.exports = { buildTrendPayload };
