'use strict';
// 指标目录：id -> { title, unit, direction }；direction=up 值越大越差，down 值越小越差。
// 注意：待发货订单列表无创建时间，按 order_sn 的 YYMMDD 前缀按天估算（见 collectors/parse.orderAgeBuckets）
const METRICS = {
  'order.pending_12_24h': { title: '今日待发货', unit: '单', direction: 'up' },
  'order.pending_24h': { title: '昨日及更早待发货', unit: '单', direction: 'up' },
  'order.cancel_pending': { title: '待处理取消申请', unit: '单', direction: 'up' },
  'firstmile.unbound': { title: '首公里未交接', unit: '单', direction: 'up' },
  'product.out_of_stock': { title: '断货商品', unit: '个', direction: 'up' },
  'product.low_stock': { title: '低库存商品', unit: '个', direction: 'up' },
  'product.violations': { title: '问题商品数', unit: '个', direction: 'up' },
  'health.late_shipment_rate': { title: '迟发货率', unit: '%', direction: 'up' },
  'health.non_fulfilment_rate': { title: '未完成率', unit: '%', direction: 'up' },
  'health.rating': { title: '店铺评分', unit: '分', direction: 'down' },
  'health.penalty_points': { title: '扣分记录数', unit: '次', direction: 'up' },
  'health.punishments': { title: '进行中处罚', unit: '条', direction: 'up' },
  // 广告域（官方小时报表单日聚合；balance 含付费+赠金）
  'ads.spend_today': { title: '今日广告花费', unit: '元', direction: 'up' },
  'ads.roas_today': { title: '今日广告 ROAS', unit: '倍', direction: 'down' },
  'ads.cpc_today': { title: '今日平均 CPC', unit: '元', direction: 'up' },
  'ads.balance': { title: '广告账户余额', unit: '元', direction: 'down' },
  // 资金域（payout 仅跨境、wallet 仅本土，两型店铺自动采各自可用指标）
  'funds.payout_15d': { title: '近15天打款金额', unit: '元', direction: 'down' },
  'funds.pending_txn': { title: '处理中钱包流水', unit: '笔', direction: 'up' },
  'funds.failed_txn': { title: '失败钱包流水', unit: '笔', direction: 'up' },
  'funds.wallet_balance': { title: '钱包余额', unit: '元', direction: 'down' },
  // 售后评价域（差评 = 近 24h 1~3 星评价，关键词命中仅作告警明细展示）
  'aftersale.returns_24h': { title: '近24h退货申请', unit: '单', direction: 'up' },
  'aftersale.negative_24h': { title: '近24h差评', unit: '条', direction: 'up' },
};

/** 指标是否为金额类（单位「元」；阈值按人民币比较、展示按全局模式换算） */
function isMoneyMetric(metricId) {
  return (METRICS[metricId] || {}).unit === '元';
}

// 大屏对比矩阵展示的核心指标（顺序即列顺序）
const MATRIX_METRICS = [
  'order.pending_24h',
  'firstmile.unbound',
  'product.out_of_stock',
  'product.low_stock',
  'product.violations',
  'health.late_shipment_rate',
  'health.non_fulfilment_rate',
  'health.rating',
  'health.punishments',
  'ads.spend_today',
  'ads.roas_today',
  'ads.cpc_today',
  'ads.balance',
  'funds.payout_15d',
  'funds.pending_txn',
  'funds.failed_txn',
  'funds.wallet_balance',
  'aftersale.returns_24h',
  'aftersale.negative_24h',
];

module.exports = {
  METRICS,
  isMoneyMetric,
  MATRIX_METRICS,
};
