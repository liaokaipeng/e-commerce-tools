'use strict';
// 采集响应归一化纯函数入口：把各域接口返回值转成统一指标数值 / 告警明细行。
// 全部为无副作用纯函数（便于单测），不发起任何请求；接口字段的多键兜底见各函数注释。
// 原单文件把全部域解析集中一处，现按域拆到 parse/ 子目录，本入口只做聚合导出（对外 API 不变）：
//   common.js    通用工具（截断/明细/取值/列表与总数）
//   datetime.js  日期格式化与单号日期解析
//   order.js     订单域分桶
//   product.js   商品域库存
//   health.js    账户健康域
//   ads.js       广告域
//   funds.js     资金域
//   aftersale.js 售后评价域
//   errors.js    错误分类
const c = require('./common');
const dt = require('./datetime');
const order = require('./order');
const product = require('./product');
const health = require('./health');
const ads = require('./ads');
const funds = require('./funds');
const aftersale = require('./aftersale');
const errors = require('./errors');

module.exports = {
  // 通用工具（common.js）
  snippet: c.snippet,
  detail: c.detail,
  firstOf: c.firstOf,
  round2: c.round2,
  listOf: c.listOf,
  totalOf: c.totalOf,
  // 日期（datetime.js）
  fmtSec: dt.fmtSec,
  orderSnDate: dt.orderSnDate,
  snDateText: dt.snDateText,
  formatDdMmYyyy: dt.formatDdMmYyyy,
  // 订单域（order.js）
  orderAgeGroups: order.orderAgeGroups,
  orderAgeBuckets: order.orderAgeBuckets,
  // 商品域（product.js）
  stockOfModel: product.stockOfModel,
  stockSummary: product.stockSummary,
  itemStockTotal: product.itemStockTotal,
  itemStockState: product.itemStockState,
  // 账户健康域（health.js）
  normalizeHealth: health.normalizeHealth,
  normalizePunishments: health.normalizePunishments,
  violationBreakdown: health.violationBreakdown,
  // 广告域（ads.js）
  normalizeAdsHourly: ads.normalizeAdsHourly,
  normalizeBalance: ads.normalizeBalance,
  // 资金域（funds.js）
  walletSummary: funds.walletSummary,
  // 售后评价域（aftersale.js）
  recentReturns: aftersale.recentReturns,
  returnSummary: aftersale.returnSummary,
  negativeCommentItems: aftersale.negativeCommentItems,
  commentSummary: aftersale.commentSummary,
  // 错误分类（errors.js）
  isPermissionDenied: errors.isPermissionDenied,
  allPermissionDenied: errors.allPermissionDenied,
};
