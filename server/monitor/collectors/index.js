'use strict';
// 采集器入口：按域调用开放平台接口（查询类接口统一 GET，经 client.callOpenApi 自动签名/刷新），
// 返回归一化指标 { domain, metrics: { metricId: number|null } }。
// 单个子调用独立容错，全部子调用失败才抛错（调度器记入采集失败并触发系统告警）。
// 显式导出（不把 constants 与 parse 平铺进同一命名空间），避免命名空间混淆。
//
// 同目录职责划分：
//   constants.js 翻页/时间窗/阈值常量与枚举映射
//   parse/       归一化纯函数（单测覆盖，见 parse/index.js）
//   paging.js    通用翻页收集（cursor / page_no）
//   catalog.js   在售商品清单查询（商品域与降级差评扫描共用）
//   shop-info.js 店铺名/地区查询
//   order.js / product.js / health.js / ads.js / funds.js / aftersale.js  各域采集与编排
const constants = require('./constants');
const parse = require('./parse');
const { collectOrderDomain } = require('./order');
const { collectProductDomain } = require('./product');
const { collectHealthDomain } = require('./health');
const { collectAdsDomain } = require('./ads');
const { collectFundsDomain } = require('./funds');
const { collectAftersaleDomain } = require('./aftersale');
const { fetchShopInfo } = require('./shop-info');

/** 采集一个域：返回 { domain, metrics, details?, errors }；子调用独立容错，全失败才抛错 */
async function collectDomain(shopId, domain) {
  if (domain === 'order') return collectOrderDomain(shopId);
  if (domain === 'product') return collectProductDomain(shopId);
  if (domain === 'health') return collectHealthDomain(shopId);
  if (domain === 'ads') return collectAdsDomain(shopId);
  if (domain === 'funds') return collectFundsDomain(shopId);
  if (domain === 'aftersale') return collectAftersaleDomain(shopId);
  throw new Error('未知采集域：' + domain);
}

module.exports = {
  // 采集域常量（constants.js）
  PAGE_SIZE: constants.PAGE_SIZE,
  MAX_PAGES: constants.MAX_PAGES,
  ORDER_WINDOW_DAYS: constants.ORDER_WINDOW_DAYS,
  ITEM_SCAN_WINDOW_DAYS: constants.ITEM_SCAN_WINDOW_DAYS,
  ITEMS_PER_SCAN: constants.ITEMS_PER_SCAN,
  LOW_STOCK_LINE: constants.LOW_STOCK_LINE,
  FUNDS_WINDOW_DAYS: constants.FUNDS_WINDOW_DAYS,
  AFTERSALE_WINDOW_MS: constants.AFTERSALE_WINDOW_MS,
  COMMENT_SCAN_ITEMS: constants.COMMENT_SCAN_ITEMS,
  NEGATIVE_STAR_MAX: constants.NEGATIVE_STAR_MAX,
  COMMENT_KEYWORDS: constants.COMMENT_KEYWORDS,
  SNIPPET_MAX: constants.SNIPPET_MAX,
  PUNISHMENT_TIER_NAMES: constants.PUNISHMENT_TIER_NAMES,
  VIOLATION_REASON_NAMES: constants.VIOLATION_REASON_NAMES,
  RETURN_REASON_NAMES: constants.RETURN_REASON_NAMES,
  // 归一化纯函数（parse/）
  snippet: parse.snippet,
  detail: parse.detail,
  fmtSec: parse.fmtSec,
  snDateText: parse.snDateText,
  firstOf: parse.firstOf,
  round2: parse.round2,
  listOf: parse.listOf,
  totalOf: parse.totalOf,
  orderSnDate: parse.orderSnDate,
  orderAgeGroups: parse.orderAgeGroups,
  orderAgeBuckets: parse.orderAgeBuckets,
  stockOfModel: parse.stockOfModel,
  stockSummary: parse.stockSummary,
  itemStockTotal: parse.itemStockTotal,
  itemStockState: parse.itemStockState,
  normalizeHealth: parse.normalizeHealth,
  formatDdMmYyyy: parse.formatDdMmYyyy,
  normalizeAdsHourly: parse.normalizeAdsHourly,
  normalizeBalance: parse.normalizeBalance,
  normalizePunishments: parse.normalizePunishments,
  violationBreakdown: parse.violationBreakdown,
  walletSummary: parse.walletSummary,
  recentReturns: parse.recentReturns,
  returnSummary: parse.returnSummary,
  negativeCommentItems: parse.negativeCommentItems,
  commentSummary: parse.commentSummary,
  isPermissionDenied: parse.isPermissionDenied,
  allPermissionDenied: parse.allPermissionDenied,
  // 采集编排
  collectDomain,
  fetchShopInfo,
};
