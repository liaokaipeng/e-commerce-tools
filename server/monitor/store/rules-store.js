'use strict';
// 规则持久化：默认规则 + 用户覆盖（rules.json）的合并与读写。
const { RULES_BY_ID } = require('../constants');
const { mergeRules, indexRules } = require('../rules');
const { RULES_FILE, readJson, writeJson } = require('./paths');

let ruleOverrides = readJson(RULES_FILE, {});
let mergedRules = mergeRules(ruleOverrides);
let rulesById = indexRules(mergedRules);

/** 当前生效规则（默认规则 + rules.json 覆盖合并） */
function getRules() {
  return mergedRules;
}

function getRulesById() {
  return rulesById;
}

/** 保存用户覆盖（校验：仅允许已注册规则 id；thresholds 收数值或 null（null=留空不触发）；enabled 布尔） */
function setRuleOverrides(overrides) {
  if (!overrides || typeof overrides !== 'object') throw new Error('覆盖配置格式错误');
  const clean = {};
  for (const [id, o] of Object.entries(overrides)) {
    if (!RULES_BY_ID[id]) throw new Error('未知规则 id：' + id);
    if (!o || typeof o !== 'object') continue;
    const entry = {};
    if (typeof o.enabled === 'boolean') entry.enabled = o.enabled;
    if (o.thresholds && typeof o.thresholds === 'object') {
      const th = {};
      for (const [k, v] of Object.entries(o.thresholds)) {
        // null = 显式留空（该级别不触发），需原样保留给 mergeRules 删除默认阈值
        if (v === null) th[k] = null;
        else if (typeof v === 'number' && isFinite(v)) th[k] = v;
      }
      if (Object.keys(th).length) entry.thresholds = th;
    }
    if (Object.keys(entry).length) clean[id] = entry;
  }
  ruleOverrides = clean;
  mergedRules = mergeRules(ruleOverrides);
  rulesById = indexRules(mergedRules);
  writeJson(RULES_FILE, ruleOverrides);
  return mergedRules;
}

module.exports = { getRules, getRulesById, setRuleOverrides };
