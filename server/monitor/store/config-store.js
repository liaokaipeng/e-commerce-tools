'use strict';
// 监控店铺配置持久化（config.json）：排除名单 + 金额单位模式。
const { CONFIG_FILE, readJson, writeJson } = require('./paths');

// ---------- 监控店铺配置（excludedShopIds 排除名单） ----------
// 语义：已授权店铺默认全部监控；把不需要监控的店铺加进排除名单后，
// 调度器跳过其采集、大屏不展示其数据与告警。名单为空 = 全部监控。
function loadExcluded() {
  const c = readJson(CONFIG_FILE, {});
  const arr = Array.isArray(c.excludedShopIds) ? c.excludedShopIds : [];
  return new Set(arr.map(String).filter(Boolean));
}

let excludedShopIds = loadExcluded();

/** 当前排除名单（shopId 集合，Set 共享引用勿修改） */
function getExcludedShopIds() {
  return excludedShopIds;
}

/** 店铺是否处于监控中（未在排除名单即监控） */
function isMonitored(shopId) {
  return !excludedShopIds.has(String(shopId));
}

/** 保存排除名单（校验为字符串数组；去重后写盘），返回新的排除集合 */
function setExcludedShopIds(ids) {
  if (!Array.isArray(ids)) throw new Error('excludedShopIds 必须是数组');
  excludedShopIds = new Set(ids.map(String).filter(Boolean));
  writeJson(CONFIG_FILE, Object.assign({}, readJson(CONFIG_FILE, {}), { excludedShopIds: [...excludedShopIds] }));
  return excludedShopIds;
}

// ---------- 金额单位模式（currencyMode，大屏金额展示全局切换） ----------
// 语义：'local'（默认，当地货币展示）/ 'rmb'（换算人民币展示）；规则面板金额阈值一律按人民币配置与比较。
const VALID_CURRENCY_MODES = ['local', 'rmb'];

function loadCurrencyMode() {
  const c = readJson(CONFIG_FILE, {});
  const m = String(c.currencyMode || 'local');
  return VALID_CURRENCY_MODES.includes(m) ? m : 'local';
}

let currencyMode = loadCurrencyMode();

/** 当前金额单位模式（'local' | 'rmb'） */
function getCurrencyMode() {
  return currencyMode;
}

/** 保存金额单位模式（校验后写盘），返回生效值 */
function setCurrencyMode(mode) {
  const m = String(mode || '');
  if (!VALID_CURRENCY_MODES.includes(m)) throw new Error('无效的金额单位模式：' + m + '（可选 local / rmb）');
  currencyMode = m;
  writeJson(CONFIG_FILE, Object.assign({}, readJson(CONFIG_FILE, {}), { currencyMode: m }));
  return currencyMode;
}

module.exports = {
  getExcludedShopIds,
  isMonitored,
  setExcludedShopIds,
  getCurrencyMode,
  setCurrencyMode,
};
