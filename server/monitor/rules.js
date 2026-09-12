'use strict';
// 规则引擎（纯函数，供单测）：阈值分级评估 + 用户覆盖合并 + 指标定级（矩阵着色用）。
const { METRICS, DEFAULT_RULES, RULES_BY_ID, LEVELS, LEVEL_ORDER } = require('./constants');

/**
 * 评估单条 threshold 规则：
 * - direction=up：值 >= p0 → P0，>= p1 → P1，>= p2 → P2
 * - direction=down：值 <= p0 → P0，<= p1 → P1，<= p2 → P2
 * 某级别阈值缺省（undefined）则跳过该级别；未触发返回 null。
 * @param {object} rule 含 thresholds {p0,p1,p2} 的规则（direction 取自 METRICS）
 * @param {number} value 当前值
 * @returns {'P0'|'P1'|'P2'|null}
 */
function evaluateRule(rule, value) {
  if (rule == null || rule.type !== 'threshold' || typeof value !== 'number' || !isFinite(value)) return null;
  const m = METRICS[rule.metric] || {};
  const dir = m.direction || 'up';
  const th = rule.thresholds || {};
  for (const lv of LEVELS) {
    const t = th[lv.toLowerCase()];
    if (typeof t !== 'number' || !isFinite(t)) continue;
    if (dir === 'up' ? value >= t : value <= t) return lv;
  }
  return null;
}

/** 更严重的级别比较：a 比 b 严重返回 true */
function isMoreSevere(a, b) {
  if (!a) return false;
  if (!b) return true;
  return (LEVEL_ORDER[a] || 0) > (LEVEL_ORDER[b] || 0);
}

/**
 * 合并用户覆盖到默认规则：rules.json 存 { [ruleId]: { enabled, thresholds } }，
 * 未覆盖的规则保持默认。返回合并后的规则数组（含全部字段）。
 *
 * thresholds 的合并语义（与规则面板「留空 = 该级别不触发」一致）：
 *   - 不传该级别 → 保留默认阈值；
 *   - 传数值     → 覆盖为数值；
 *   - 传 null    → 显式留空，删除该级别（否则默认阈值会「复活」，用户清空输入框等于没改）。
 */
function mergeRules(overrides) {
  const ov = overrides && typeof overrides === 'object' ? overrides : {};
  return DEFAULT_RULES.map((r) => {
    const o = ov[r.id] || {};
    const merged = Object.assign({}, r, { enabled: o.enabled !== false });
    if (o.thresholds && typeof o.thresholds === 'object') {
      const th = Object.assign({}, r.thresholds);
      for (const [k, v] of Object.entries(o.thresholds)) {
        if (v === null) delete th[k];
        else if (typeof v === 'number' && isFinite(v)) th[k] = v;
      }
      merged.thresholds = th;
    }
    return merged;
  });
}

/** 由规则数组重建索引 */
function indexRules(rules) {
  const byId = {};
  for (const r of rules) byId[r.id] = r;
  return byId;
}

/**
 * 指标当前值定级（大屏矩阵/店卡着色用）：返回 { level, rule } 或 { level: null }。
 */
function levelOf(metricId, value, rulesById) {
  const rule = (rulesById || RULES_BY_ID)[metricId];
  if (!rule || rule.enabled === false) return { level: null, rule: null };
  const level = evaluateRule(rule, value);
  return { level, rule };
}

module.exports = { evaluateRule, isMoreSevere, mergeRules, indexRules, levelOf };
