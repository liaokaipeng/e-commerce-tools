'use strict';
// 告警生命周期：快照指标入库 → 规则评估 → 去重/升级/回稳移除/关闭重开；系统自检告警。
const { METRICS } = require('../constants');
const { evaluateRule, isMoreSevere } = require('../rules');
const store = require('../store');
const { broadcast } = require('./sse');
const state = require('./state');
const { applyDetail, compareValue } = require('./render');
const { prune } = require('./actions');

// 时间触发升级窗口：P2 持续 24h 升 P1；P1 每 2h 重闪（大屏重新置顶提醒）
const ESCALATE_P2_MS = 24 * 3600 * 1000;
const REFLASH_P1_MS = 2 * 3600 * 1000;

/**
 * 指标快照入库：逐指标评估规则，触发/升级/去重计数。
 * @param {string} shopId
 * @param {string} domain 采集域（order/product/health/ads/funds/aftersale）
 * @param {object} metrics { metricId: number }
 * @param {number} at 采样时间（ms）
 * @param {object} [details] { metricId: 明细 }，值为纯文本（拼入消息，兼容旧调用）
 *                           或 { text, rows } 对象（text 拼入消息；rows 为结构化明细行 [{id,title,sub}]，存入告警供大屏详情抽屉展示）
 */
function ingest(shopId, domain, metrics, at, details) {
  const alerts = state.alerts;
  const now = at || Date.now();
  const rulesById = store.getRulesById();
  const changed = [];
  for (const [metric, v] of Object.entries(metrics || {})) {
    const rule = rulesById[metric];
    if (!rule || rule.enabled === false) continue;
    const level = evaluateRule(rule, compareValue(metric, v, shopId));
    const existing = state.findAlert(shopId, rule.id);
    if (!level) {
      if (existing) existing.current = v; // 未触发但告警开着：更新当前值，供回稳清理判断
      continue;
    }
    if (!existing) {
      const a = {
        id: shopId + ':' + rule.id,
        seq: 1,
        shopId,
        ruleId: rule.id,
        domain: rule.domain,
        metric: rule.metric,
        title: rule.title,
        unit: (METRICS[rule.metric] || {}).unit || '',
        level,
        status: 'open',
        current: v,
        count: 1,
        firstAt: now,
        lastAt: now,
        updatedAt: now,
        suggest: rule.suggest,
        message: '',
      };
      applyDetail(a, details);
      alerts.push(a);
      changed.push(Object.assign({}, a, { change: 'new' }));
      continue;
    }
    if (existing.status === 'closed') {
      // 人工关闭后再次触发：重新打开（seq+1 便于前端识别新记录）
      existing.seq = (existing.seq || 1) + 1;
      existing.status = 'open';
      existing.count = 1;
      existing.current = v;
      existing.level = level;
      existing.firstAt = now;
      existing.lastAt = now;
      existing.updatedAt = now;
      applyDetail(existing, details);
      changed.push(Object.assign({}, existing, { change: 'reopen' }));
      continue;
    }
    existing.current = v;
    existing.lastAt = now;
    existing.count = (existing.count || 0) + 1;
    const escalated = isMoreSevere(level, existing.level);
    if (escalated) existing.level = level;
    applyDetail(existing, details);
    existing.updatedAt = now;
    changed.push(Object.assign({}, existing, { change: escalated ? 'escalate' : 'update' }));
  }
  // 例行维护：回稳清理 + 时间触发升级
  maintain(now);
  state.markDirty();
  for (const a of changed) broadcast('alert', a);
  prune();
  return changed;
}

/**
 * 例行维护：
 * - 回稳清理：开着的告警当前值已回到阈值内 → 直接从告警流移除
 * - 时间升级：open P2 持续 24h → P1；open P1 每 2h 重闪
 */
function maintain(now) {
  const alerts = state.alerts;
  const t = now || Date.now();
  const rulesById = store.getRulesById();
  // 倒序遍历：回稳的告警直接从数组移除（已移除「已恢复」状态），倒序可安全 splice
  for (let i = alerts.length - 1; i >= 0; i--) {
    const a = alerts[i];
    if (a.status !== 'open' && a.status !== 'ack') continue;
    const rule = rulesById[a.ruleId];
    if (!rule) continue;
    if (a.domain !== 'system') {
      const level = evaluateRule(rule, compareValue(a.metric, a.current, a.shopId));
      if (!level) {
        alerts.splice(i, 1);
        broadcast('alert', Object.assign({}, a, { change: 'delete' }));
        continue;
      }
    }
    if (a.status === 'open' && a.level === 'P2' && t - a.firstAt >= ESCALATE_P2_MS) {
      a.level = 'P1';
      a.updatedAt = t;
      broadcast('alert', Object.assign({}, a, { change: 'escalate' }));
    } else if (a.status === 'open' && a.level === 'P1' && t - a.updatedAt >= REFLASH_P1_MS) {
      a.updatedAt = t; // 重新置顶闪烁提醒
      broadcast('alert', Object.assign({}, a, { change: 'reflash' }));
    }
  }
  state.markDirty();
}

/**
 * 采集失败记录（系统自检告警）：
 * 连续失败 1 次 P2 / 2 次 P1 / ≥5 次 P0（P0 留给「长时间失联」，
 * 避免店铺统一失效时第一波 3 个域同时失败就把全场刷成红色）；
 * 成功采集后调用 systemOk 移除告警。
 */
function systemFail(shopId, domain, message, at) {
  const alerts = state.alerts;
  const now = at || Date.now();
  const rule = store.getRulesById()['system.collect_fail'];
  const existing = state.findAlert(shopId, 'system.collect_fail');
  // 规则被用户关闭：不再产生系统自检告警；已开着的直接从告警流移除（否则会永远挂在那里，
  // 因为 maintain 的回稳检测只对业务域生效，system 域没有别的清理信号）。
  if (!rule || rule.enabled === false) {
    if (existing && (existing.status === 'open' || existing.status === 'ack')) {
      const i = state.indexOfAlert(existing);
      if (i >= 0) alerts.splice(i, 1);
      broadcast('alert', Object.assign({}, existing, { change: 'delete' }));
    }
    state.markDirty();
    return null;
  }
  const count = (existing && existing.status !== 'closed' ? existing.count : 0) + 1;
  const level = count >= 5 ? 'P0' : count >= 2 ? 'P1' : 'P2';
  const text = `店铺最近一次采集失败（${domain}）：${message || '未知错误'}（连续 ${count} 次）`;
  if (!existing || existing.status === 'closed') {
    const a = {
      id: shopId + ':system.collect_fail',
      seq: existing ? (existing.seq || 1) + 1 : 1,
      shopId,
      ruleId: 'system.collect_fail',
      domain: 'system',
      metric: 'system.collect_fail',
      title: rule ? rule.title : '采集连续失败',
      unit: '次',
      level,
      status: 'open',
      current: count,
      count,
      firstAt: now,
      lastAt: now,
      updatedAt: now,
      suggest: rule ? rule.suggest : '',
      message: text,
    };
    alerts.push(a);
    broadcast('alert', Object.assign({}, a, { change: 'new' }));
  } else {
    existing.current = count;
    existing.count = count;
    existing.lastAt = now;
    existing.updatedAt = now;
    const escalated = isMoreSevere(level, existing.level);
    if (escalated) existing.level = level;
    existing.message = text;
    broadcast('alert', Object.assign({}, existing, { change: escalated ? 'escalate' : 'update' }));
  }
  state.markDirty();
  prune();
}

/** 采集成功：直接从告警流移除系统自检告警 */
function systemOk(shopId) {
  const alerts = state.alerts;
  const a = state.findAlert(shopId, 'system.collect_fail');
  if (a && (a.status === 'open' || a.status === 'ack')) {
    const i = state.indexOfAlert(a);
    if (i >= 0) alerts.splice(i, 1);
    broadcast('alert', Object.assign({}, a, { change: 'delete' }));
    state.markDirty();
  }
}

module.exports = { ingest, maintain, systemFail, systemOk };
