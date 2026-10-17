'use strict';
// 采集器入口：按域调用开放平台接口（查询类接口统一 GET，经 client.callOpenApi 自动签名/刷新），
// 返回归一化指标 { domain, metrics: { metricId: number|null } }。
// 单个子调用独立容错，全部子调用失败才抛错（调度器记入采集失败并触发系统告警）。
// 本入口只聚合调度所需与单测实际消费的符号；常量与完整解析函数请直接从
// ./constants / ./parse 引入。
//
// 同目录职责划分：
//   constants.js 翻页/时间窗/阈值常量与枚举映射
//   parse/       归一化纯函数（单测覆盖，见 parse/index.js）
//   paging.js    通用翻页收集（cursor / page_no）
//   catalog.js   在售商品清单查询（商品域与降级差评扫描共用）
//   shop-info.js 店铺名/地区查询
//   order.js / product.js / health.js / ads.js / funds.js / aftersale.js  各域采集与编排
const parse = require('./parse');
const { collectOrderDomain } = require('./order');
const { collectProductDomain } = require('./product');
const { collectHealthDomain } = require('./health');
const { collectAdsDomain } = require('./ads');
const { collectFundsDomain } = require('./funds');
const { collectAftersaleDomain } = require('./aftersale');
const { fetchShopInfo } = require('./shop-info');

// 域 -> 采集函数映射表（新增域只加条目，不改分发逻辑）
const DOMAIN_COLLECTORS = {
  order: collectOrderDomain,
  product: collectProductDomain,
  health: collectHealthDomain,
  ads: collectAdsDomain,
  funds: collectFundsDomain,
  aftersale: collectAftersaleDomain,
};

/** 采集一个域：返回 { domain, metrics, details?, errors }；子调用独立容错，全失败才抛错 */
async function collectDomain(shopId, domain) {
  const collect = DOMAIN_COLLECTORS[domain];
  if (!collect) throw new Error('未知采集域：' + domain);
  return collect(shopId);
}

module.exports = {
  // 归一化纯函数（parse/，仅保留单测与调度实际消费的符号）
  listOf: parse.listOf,
  totalOf: parse.totalOf,
  orderSnDate: parse.orderSnDate,
  orderAgeGroups: parse.orderAgeGroups,
  orderAgeBuckets: parse.orderAgeBuckets,
  stockOfModel: parse.stockOfModel,
  itemStockTotal: parse.itemStockTotal,
  itemStockState: parse.itemStockState,
  normalizeHealth: parse.normalizeHealth,
  formatDdMmYyyy: parse.formatDdMmYyyy,
  normalizeAdsHourly: parse.normalizeAdsHourly,
  normalizeBalance: parse.normalizeBalance,
  normalizePunishments: parse.normalizePunishments,
  violationBreakdown: parse.violationBreakdown,
  walletSummary: parse.walletSummary,
  returnSummary: parse.returnSummary,
  negativeCommentItems: parse.negativeCommentItems,
  commentSummary: parse.commentSummary,
  isPermissionDenied: parse.isPermissionDenied,
  // 采集编排
  collectDomain,
  fetchShopInfo,
};
