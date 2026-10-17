'use strict';
// 监控店铺配置持久化（config.json）：排除名单 + 金额单位模式。
const { CONFIG_FILE, readJson, writeJson } = require('./paths');

/** 读-改-写回 config.json（合并语义）：两个 setter 共用同一「读→合并→写」口径 */
function patchConfig(patch) {
  writeJson(CONFIG_FILE, Object.assign({}, readJson(CONFIG_FILE, {}), patch()));
}

// ---------- 监控店铺配置（excludedShopIds 排除名单） ----------
// 语义：已授权店铺默认全部监控；把不需要监控的店铺加进排除名单后，
// 调度器跳过其采集、大屏不展示其数据与告警。名单为空 = 全部监控。
function loadExcluded(config) {
  const arr = Array.isArray(config.excludedShopIds) ? config.excludedShopIds : [];
  return new Set(arr.map(String).filter(Boolean));
}

// 模块加载时只读一次配置文件（原实现 loadExcluded / loadCurrencyMode 各读一遍）
const initialConfig = readJson(CONFIG_FILE, {});
let excludedShopIds = loadExcluded(initialConfig);

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
  patchConfig(() => ({ excludedShopIds: [...excludedShopIds] }));
  return excludedShopIds;
}

// ---------- 金额单位模式（currencyMode，大屏金额展示全局切换） ----------
// 语义：'local'（默认，当地货币展示）/ 'rmb'（换算人民币展示）；规则面板金额阈值一律按人民币配置与比较。
const VALID_CURRENCY_MODES = ['local', 'rmb'];

function loadCurrencyMode(config) {
  const m = String(config.currencyMode || 'local');
  return VALID_CURRENCY_MODES.includes(m) ? m : 'local';
}

let currencyMode = loadCurrencyMode(initialConfig);

/** 当前金额单位模式（'local' | 'rmb'） */
function getCurrencyMode() {
  return currencyMode;
}

/** 保存金额单位模式（校验后写盘），返回生效值 */
function setCurrencyMode(mode) {
  const m = String(mode || '');
  if (!VALID_CURRENCY_MODES.includes(m)) throw new Error('无效的金额单位模式：' + m + '（可选 local / rmb）');
  currencyMode = m;
  patchConfig(() => ({ currencyMode: m }));
  return currencyMode;
}

module.exports = {
  getExcludedShopIds,
  isMonitored,
  setExcludedShopIds,
  getCurrencyMode,
  setCurrencyMode,
};
