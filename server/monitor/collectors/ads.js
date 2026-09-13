'use strict';
// 广告域采集：当日小时级花费/ROAS/CPC 与账户余额。
// 接口形态（官方文档 2026-08 调研，未生产实测）：
//   ads.get_all_cpc_ads_hourly_performance  performance_date(DD-MM-YYYY 单日,必填)，response 为小时数组，无分页
//   ads.get_total_balance                   无业务参数，response.total_balance（含付费+赠金）
const { callOpenApi } = require('../../openapi/client');
const { listOf, normalizeAdsHourly, normalizeBalance, formatDdMmYyyy, allPermissionDenied } = require('./parse');

async function collectAdsDomain(shopId) {
  const metrics = {};
  const errors = [];
  let anyOk = false;
  try {
    const j = await callOpenApi('/api/v2/ads/get_all_cpc_ads_hourly_performance', {
      performance_date: formatDdMmYyyy(new Date()),
    }, { shopId, method: 'GET' });
    const agg = normalizeAdsHourly(listOf(j, ['response']));
    if (agg.spend != null) metrics['ads.spend_today'] = agg.spend;
    if (agg.roas != null) metrics['ads.roas_today'] = agg.roas;
    if (agg.cpc != null) metrics['ads.cpc_today'] = agg.cpc;
    anyOk = true;
  } catch (e) {
    errors.push('小时表现：' + e.message);
  }
  try {
    const j = await callOpenApi('/api/v2/ads/get_total_balance', {}, { shopId, method: 'GET' });
    const b = normalizeBalance(j);
    if (b != null) metrics['ads.balance'] = b;
    anyOk = true;
  } catch (e) {
    errors.push('广告余额：' + e.message);
  }
  if (!anyOk) {
    if (allPermissionDenied(errors)) return { domain: 'ads', metrics, errors, unsupported: true, reason: errors.join('；') };
    throw new Error(errors.join('；') || '广告域无可用数据');
  }
  return { domain: 'ads', metrics, errors };
}

module.exports = { collectAdsDomain };
