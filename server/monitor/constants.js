'use strict';
// 监控大屏常量：数据目录 / 告警级别 / 采集任务定义 / 指标目录 / 默认规则。
// 默认规则只做「开箱即用」基线，用户在大屏规则面板修改后覆盖值存 rules.json（store.js 合并）。
const path = require('path');

// 数据目录：默认 server/data/monitor（gitignored，凭证不入库）；测试经 MONITOR_DATA_DIR 隔离。
const DATA_DIR = process.env.MONITOR_DATA_DIR || path.join(__dirname, '..', 'data', 'monitor');
// 原始快照保留天数（周同比/滚动基线需要历史窗口）
const RETENTION_DAYS = 90;
// 单店单指标单日快照上限（防异常写入撑爆磁盘）
const SNAPSHOT_CAP_PER_DAY = 2000;
// 内存告警条数上限（超出时淘汰最旧的已关闭记录）
const ALERT_CAP = 500;
// SSE 事件回放缓存条数（迟到连接回放用，同 video/job.js 的思路）
const EVENT_LOG_CAP = 200;

// 告警级别：P0 最严重（大屏红色脉冲置顶）
const LEVELS = ['P0', 'P1', 'P2'];
const LEVEL_ORDER = { P2: 1, P1: 2, P0: 3 };
const LEVEL_STYLE = {
  P0: { name: '紧急', color: '#FF3B30' },
  P1: { name: '重要', color: '#FF9500' },
  P2: { name: '提醒', color: '#FFD60A' },
};
const OK_COLOR = '#30D158';

// 采集任务定义：调度器按 intervalMs 轮询执行（collectors.js 提供 collectDomain）
const JOBS = [
  { domain: 'order', intervalMs: 10 * 60 * 1000, title: '订单履约' },
  { domain: 'product', intervalMs: 30 * 60 * 1000, title: '商品库存' },
  { domain: 'health', intervalMs: 60 * 60 * 1000, title: '账户健康' },
  { domain: 'ads', intervalMs: 60 * 60 * 1000, title: '广告投放' },
  { domain: 'funds', intervalMs: 60 * 60 * 1000, title: '资金结算' },
  { domain: 'aftersale', intervalMs: 60 * 60 * 1000, title: '售后评价' },
];

// 指标目录：id -> { title, unit, direction }；direction=up 值越大越差，down 值越小越差
// 注意：待发货订单列表无创建时间，按 order_sn 的 YYMMDD 前缀按天估算（见 collectors.orderAgeBuckets）
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

// 默认规则：threshold 型按 thresholds 分级比较（direction 决定方向），
// thresholds 某项缺省表示该级别不触发（如扣分 P2 不报）。
const DEFAULT_RULES = [
  {
    id: 'order.pending_24h', domain: 'order', metric: 'order.pending_24h',
    title: '昨日及更早待发货订单', type: 'threshold',
    thresholds: { p2: 3, p1: 8, p0: 15 },
    suggest: '检查打单与首公里交接，必要时延长 DTS',
  },
  {
    id: 'order.pending_12_24h', domain: 'order', metric: 'order.pending_12_24h',
    title: '今日待发货订单', type: 'threshold',
    thresholds: { p2: 5, p1: 15, p0: 30 },
    suggest: '加快打包发货节奏，避免订单逼近发货时限',
  },
  {
    id: 'order.cancel_pending', domain: 'order', metric: 'order.cancel_pending',
    title: '待处理买家取消申请', type: 'threshold',
    thresholds: { p2: 3, p1: 8, p0: 15 },
    suggest: '及时响应取消申请，避免系统自动取消计入未完成率',
  },
  {
    id: 'firstmile.unbound', domain: 'order', metric: 'firstmile.unbound',
    title: '首公里未交接订单', type: 'threshold',
    thresholds: { p2: 5, p1: 15, p0: 30 },
    suggest: '尽快打印面单并交付 SLS 转运仓，避免订单卡在首公里',
  },
  {
    id: 'product.out_of_stock', domain: 'product', metric: 'product.out_of_stock',
    title: '断货商品数', type: 'threshold',
    thresholds: { p2: 3, p1: 10, p0: 25 },
    suggest: '爆款优先补货，断货影响搜索权重与销量',
  },
  {
    id: 'product.low_stock', domain: 'product', metric: 'product.low_stock',
    title: '低库存商品数', type: 'threshold',
    thresholds: { p2: 10, p1: 30, p0: 60 },
    suggest: '低于安全线（默认5件）的商品尽快补货',
  },
  {
    id: 'product.violations', domain: 'product', metric: 'product.violations',
    title: '问题商品数', type: 'threshold',
    thresholds: { p2: 1, p1: 3, p0: 8 },
    suggest: '查看问题清单（违规/禁卖等）并及时整改，避免累计扣分',
  },
  {
    id: 'health.late_shipment_rate', domain: 'health', metric: 'health.late_shipment_rate',
    title: '迟发货率', type: 'threshold',
    thresholds: { p2: 2, p1: 3.5, p0: 5 },
    suggest: '迟发货率逼近扣分线，检查打单与首公里交接效率',
  },
  {
    id: 'health.non_fulfilment_rate', domain: 'health', metric: 'health.non_fulfilment_rate',
    title: '未完成率', type: 'threshold',
    thresholds: { p2: 3, p1: 5, p0: 8 },
    suggest: '取消/退款率偏高，检查库存真实性与商品描述',
  },
  {
    id: 'health.rating', domain: 'health', metric: 'health.rating',
    title: '店铺评分', type: 'threshold',
    thresholds: { p2: 4.5, p1: 4.2, p0: 4.0 },
    suggest: '店铺评分下降，关注差评内容与客服响应',
  },
  {
    id: 'health.penalty_points', domain: 'health', metric: 'health.penalty_points',
    title: '扣分记录数', type: 'threshold',
    thresholds: { p1: 1, p0: 3 },
    suggest: '关注扣分明细与申诉窗口，避免处罚升级',
  },
  {
    id: 'health.punishments', domain: 'health', metric: 'health.punishments',
    title: '进行中处罚', type: 'threshold',
    thresholds: { p1: 1, p0: 3 },
    suggest: '官方处罚记录中存在进行中处罚，及时整改与申诉，避免升级扣分',
  },
  {
    id: 'ads.spend_today', domain: 'ads', metric: 'ads.spend_today',
    title: '今日广告花费', type: 'threshold',
    thresholds: { p2: 100, p1: 300, p0: 600 },
    suggest: '今日广告花费异常偏高，检查投放计划预算与投放时段',
  },
  {
    id: 'ads.roas_today', domain: 'ads', metric: 'ads.roas_today',
    title: '今日广告 ROAS', type: 'threshold',
    thresholds: { p2: 2, p1: 1, p0: 0.5 },
    suggest: '广告投产比偏低，检查投放商品转化与出价，及时止损',
  },
  {
    id: 'ads.cpc_today', domain: 'ads', metric: 'ads.cpc_today',
    title: '今日平均 CPC', type: 'threshold',
    thresholds: { p2: 2, p1: 3.5, p0: 5 },
    suggest: '点击单价偏高，检查关键词竞争与出价策略',
  },
  {
    id: 'ads.balance', domain: 'ads', metric: 'ads.balance',
    title: '广告账户余额', type: 'threshold',
    thresholds: { p2: 50, p1: 20, p0: 5 },
    suggest: '广告余额不足预警：尽快充值，避免广告计划因欠费停投',
  },
  {
    id: 'funds.payout_15d', domain: 'funds', metric: 'funds.payout_15d',
    title: '近15天打款金额', type: 'threshold',
    thresholds: {},
    suggest: '近 15 天打款金额偏低可能意味着打款延迟，按店铺实际结算节奏配置阈值',
  },
  {
    id: 'funds.pending_txn', domain: 'funds', metric: 'funds.pending_txn',
    title: '处理中钱包流水', type: 'threshold',
    thresholds: { p2: 1, p1: 3, p0: 5 },
    suggest: '钱包存在长时间未完成的流水（提现/打款处理中），关注是否被冻结或延迟',
  },
  {
    id: 'funds.failed_txn', domain: 'funds', metric: 'funds.failed_txn',
    title: '失败钱包流水', type: 'threshold',
    thresholds: { p1: 1, p0: 3 },
    suggest: '钱包出现失败流水（提现失败等），检查收款账户与资质',
  },
  {
    id: 'funds.wallet_balance', domain: 'funds', metric: 'funds.wallet_balance',
    title: '钱包余额', type: 'threshold',
    thresholds: {},
    suggest: '钱包余额偏低时预警（默认不告警，按店铺资金安排自行配置阈值）',
  },
  {
    id: 'aftersale.returns_24h', domain: 'aftersale', metric: 'aftersale.returns_24h',
    title: '近24h退货申请', type: 'threshold',
    thresholds: { p2: 3, p1: 8, p0: 15 },
    suggest: '退货申请突增，检查商品质量、描述与包装（告警消息含原因分布明细）',
  },
  {
    id: 'aftersale.negative_24h', domain: 'aftersale', metric: 'aftersale.negative_24h',
    title: '近24h差评', type: 'threshold',
    thresholds: { p2: 3, p1: 5, p0: 10 },
    suggest: '差评突增，检查商品质量与客服响应，及时回复差评（告警消息含关键词命中明细）',
  },
  // 系统自检：采集连续失败（engine 按连续失败次数定级：1→P2、2→P1、≥5→P0，不走常规阈值比较）
  {
    id: 'system.collect_fail', domain: 'system', metric: 'system.collect_fail',
    title: '采集连续失败', type: 'threshold',
    thresholds: { p2: 1, p1: 2, p0: 5 },
    suggest: '检查店铺授权是否有效、网络与开放平台连通性',
  },
];

const RULES_BY_ID = {};
for (const r of DEFAULT_RULES) RULES_BY_ID[r.id] = r;

module.exports = {
  DATA_DIR,
  RETENTION_DAYS,
  SNAPSHOT_CAP_PER_DAY,
  ALERT_CAP,
  EVENT_LOG_CAP,
  LEVELS,
  LEVEL_ORDER,
  LEVEL_STYLE,
  OK_COLOR,
  JOBS,
  METRICS,
  isMoneyMetric,
  MATRIX_METRICS,
  DEFAULT_RULES,
  RULES_BY_ID,
};
