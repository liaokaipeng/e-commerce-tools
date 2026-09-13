'use strict';
// 采集任务定义：调度器按 intervalMs 轮询执行（collectors/ 提供 collectDomain）。
const JOBS = [
  { domain: 'order', intervalMs: 10 * 60 * 1000, title: '订单履约' },
  { domain: 'product', intervalMs: 30 * 60 * 1000, title: '商品库存' },
  { domain: 'health', intervalMs: 60 * 60 * 1000, title: '账户健康' },
  { domain: 'ads', intervalMs: 60 * 60 * 1000, title: '广告投放' },
  { domain: 'funds', intervalMs: 60 * 60 * 1000, title: '资金结算' },
  { domain: 'aftersale', intervalMs: 60 * 60 * 1000, title: '售后评价' },
];

module.exports = { JOBS };
