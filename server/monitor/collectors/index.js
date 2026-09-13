'use strict';
// 采集器入口：按域调用开放平台接口（查询类接口统一 GET，经 client.callOpenApi 自动签名/刷新），
// 返回归一化指标 { domain, metrics: { metricId: number|null } }。
// 单个子调用独立容错，全部子调用失败才抛错（调度器记入采集失败并触发系统告警）。
//
// 同目录职责划分：
//   constants.js 翻页/时间窗/阈值常量与枚举映射
//   parse.js     归一化纯函数（单测覆盖）
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

module.exports = Object.assign({}, constants, parse, { collectDomain, fetchShopInfo });
