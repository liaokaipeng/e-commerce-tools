'use strict';
// 账户健康域采集：履约指标、扣分记录、处罚记录。
// 接口形态（生产环境实测 2026-08）：
//   account_health.get_shop_performance          response.metric_list（metric_name → current_period）+ overall_performance
//   account_health.get_penalty_point_history     response.total_count
//   account_health.get_punishment_history        punishment_status 必填（1=进行中 / 2=已结束）
const { callOpenApi } = require('../../openapi/client');
const {
  detail, listOf, totalOf, firstOf, snippet, fmtSec, normalizeHealth, normalizePunishments,
} = require('./parse');
const { PAGE_SIZE, PUNISHMENT_TIER_NAMES } = require('./constants');

async function collectHealthDomain(shopId) {
  const metrics = {};
  const errors = [];
  const details = {};
  try {
    const j = await callOpenApi('/api/v2/account_health/get_shop_performance', {}, { shopId, method: 'GET' });
    const h = normalizeHealth(j);
    metrics['health.late_shipment_rate'] = h.late_shipment_rate;
    metrics['health.non_fulfilment_rate'] = h.non_fulfilment_rate;
    metrics['health.rating'] = h.rating;
    if (Object.values(h).every((v) => v == null)) throw new Error('账户健康返回缺少可用指标');
  } catch (e) {
    errors.push('健康指标：' + e.message);
  }
  try {
    const j = await callOpenApi('/api/v2/account_health/get_penalty_point_history', {}, { shopId, method: 'GET' });
    const total = totalOf(j);
    metrics['health.penalty_points'] = total != null ? total : 0;
    // 扣分明细兜底（接口返回列表字段未实测，多键防御式提取；取不到就没有明细行）
    const plist = listOf(j, ['penalty_point_list', 'penalty_points_list', 'history_list']);
    if (plist.length) {
      details['health.penalty_points'] = detail('', plist.map((x, i) => {
        const o = x || {};
        const id = firstOf(o, ['penalty_point_id', 'penalty_id', 'id']) || 'No.' + (i + 1);
        return { id: String(id), title: String(id), sub: snippet(firstOf(o, ['reason', 'description', 'title']) || '扣分记录') };
      }));
    }
  } catch (e) {
    errors.push('扣分记录：' + e.message);
  }
  // 处罚记录（punishment_status 必填：1=进行中 / 2=已结束），级别分布进告警明细
  try {
    const j = await callOpenApi('/api/v2/account_health/get_punishment_history', {
      punishment_status: 1,
      page_no: 1,
      page_size: PAGE_SIZE,
    }, { shopId, method: 'GET' });
    const p = normalizePunishments(j);
    metrics['health.punishments'] = p.count;
    const plist = (j && j.response && Array.isArray(j.response.punishment_list)) ? j.response.punishment_list : [];
    if (p.detail || plist.length) {
      details['health.punishments'] = detail('处罚级别 ' + p.detail, plist.map((x, i) => {
        const o = x || {};
        const id = firstOf(o, ['punishment_id', 'punishment_log_id', 'log_id', 'id']) || 'No.' + (i + 1);
        const tier = PUNISHMENT_TIER_NAMES[o.reason] || (o.reason != null ? '类型' + o.reason : '未知类型');
        return { id: String(id), title: String(id), sub: tier + (o.grant_time ? '·' + fmtSec(o.grant_time) : '') };
      }));
    }
  } catch (e) {
    errors.push('处罚记录：' + e.message);
  }
  if (Object.keys(metrics).length === 0) throw new Error(errors.join('；') || '健康域无可用数据');
  return { domain: 'health', metrics, details, errors };
}

module.exports = { collectHealthDomain };
