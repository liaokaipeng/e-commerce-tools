'use strict';
// 监控大屏金额换算入口：当地货币 ↔ 人民币。
// 口径约定：
//   - 规则面板的金额阈值一律按「人民币」配置与比较（评估时把原始值换算成人民币再比阈值）；
//   - 大屏金额展示全局可切换「当地货币（默认）/ 人民币」（config.json 的 currencyMode）；
//   - 采集快照/告警 current 一律存「当地货币原始值」，展示与比较时按需换算。
// 原单文件按职责拆到 currency/ 子目录（数据源与缓存 / 地区映射 / 换算与格式化），本入口聚合导出（对外 API 不变）。
const rates = require('./currency/rates');
const regions = require('./currency/regions');
const convert = require('./currency/convert');

module.exports = {
  STATIC_RMB_RATES: rates.STATIC_RMB_RATES,
  REGION_CURRENCY: regions.REGION_CURRENCY,
  CURRENCY_SYMBOLS: regions.CURRENCY_SYMBOLS,
  ensureRates: rates.ensureRates,
  toRmb: convert.toRmb,
  fromRmb: convert.fromRmb,
  regionCurrency: regions.regionCurrency,
  symbolOf: regions.symbolOf,
  roundMoney: convert.roundMoney,
  moneyText: convert.moneyText,
  clearRateCache: rates.clearRateCache,
  ratesInfo: rates.ratesInfo,
  _test: rates._test,
};
