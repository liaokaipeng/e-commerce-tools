'use strict';
// 订单域日期分桶（纯函数）。
const { orderSnDate } = require('./datetime');

/**
 * 按单号日期把待发货订单分成「今天/更早」两组，返回各组 order_sn 列表。
 * get_order_list 列表项不含创建时间，仅 order_sn 携带 YYMMDD 日期，故按「天」粒度估算。
 */
function orderAgeGroups(orders, nowMs) {
  const today0 = new Date(nowMs || Date.now());
  today0.setHours(0, 0, 0, 0);
  const today = [];
  const older = [];
  for (const o of orders || []) {
    const sn = o && o.order_sn;
    const d = orderSnDate(sn);
    if (!d) continue;
    (d.getTime() >= today0.getTime() ? today : older).push(sn);
  }
  return { today, older };
}

/**
 * 待发货订单按单号日期分桶（纯函数）：
 * get_order_list 列表项不含创建时间，仅 order_sn 携带 YYMMDD 日期，故按「天」粒度估算：
 *   pending_12_24h = 今天创建的待发货订单（0-24 小时）
 *   pending_24h    = 昨天及更早创建的待发货订单（有超 24h 风险）
 */
function orderAgeBuckets(orders, nowMs) {
  const g = orderAgeGroups(orders, nowMs);
  return { pending_12_24h: g.today.length, pending_24h: g.older.length };
}

module.exports = { orderAgeGroups, orderAgeBuckets };
