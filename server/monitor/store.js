'use strict';
// 监控数据存储：server/data/monitor/ 下
//   rules.json      用户对默认规则的覆盖（阈值/开关），未覆盖项走 constants.DEFAULT_RULES
//   config.json     监控店铺配置（excludedShopIds 排除名单，未列出的已授权店铺全部监控）
//   alerts.json     告警全量（含状态，引擎变更后防抖落盘）
//   meta.json       店铺名缓存 / 各指标最新值 / 各域最近采集时间与失败次数
//   snapshots/{shopId}/{metric}/YYYY-MM-DD.json  当日采样数组 [{at, v}]
// 全部为本地业务数据，不含凭证（shopId 仅作目录名/键）；写入失败仅告警不中断。
const fs = require('fs');
const path = require('path');
const {
  DATA_DIR, RETENTION_DAYS, SNAPSHOT_CAP_PER_DAY, RULES_BY_ID,
} = require('./constants');
const { mergeRules, indexRules } = require('./rules');

const RULES_FILE = path.join(DATA_DIR, 'rules.json');
const ALERTS_FILE = path.join(DATA_DIR, 'alerts.json');
const META_FILE = path.join(DATA_DIR, 'meta.json');
const SNAPSHOT_DIR = path.join(DATA_DIR, 'snapshots');

function ensureDirs() {
  fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });
}

function readJson(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    console.warn('[监控] 读取数据文件失败（' + file + '）:', e.message);
    return fallback;
  }
}

function writeJson(file, data) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
    return true;
  } catch (e) {
    console.warn('[监控] 保存数据文件失败（' + file + '）:', e.message);
    return false;
  }
}

ensureDirs();

// ---------- 规则（默认 + 用户覆盖） ----------
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

/** 保存用户覆盖（校验：仅允许已注册规则 id；thresholds 仅收数值；enabled 布尔） */
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
        if (typeof v === 'number' && isFinite(v)) th[k] = v;
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

// ---------- 监控店铺配置（config.json：excludedShopIds 排除名单） ----------
// 语义：已授权店铺默认全部监控；把不需要监控的店铺加进排除名单后，
// 调度器跳过其采集、大屏不展示其数据与告警。名单为空 = 全部监控。
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');

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

// ---------- 金额单位模式（config.json：currencyMode，大屏金额展示全局切换） ----------
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

// ---------- 告警（全量落盘，由引擎调用） ----------
function loadAlerts() {
  const a = readJson(ALERTS_FILE, []);
  return Array.isArray(a) ? a : [];
}

function saveAlerts(alerts) {
  writeJson(ALERTS_FILE, alerts);
}

// ---------- 快照（append 采样 + 趋势读取） ----------
function dayStamp(ms) {
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** 追加一条采样 { at, v }；自动按天分文件并清理超过保留期的旧文件 */
function appendSample(shopId, metric, v, at) {
  if (typeof v !== 'number' || !isFinite(v)) return;
  const dir = path.join(SNAPSHOT_DIR, String(shopId), String(metric));
  const file = path.join(dir, dayStamp(at) + '.json');
  try {
    fs.mkdirSync(dir, { recursive: true });
    let arr = [];
    if (fs.existsSync(file)) {
      arr = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (!Array.isArray(arr)) arr = [];
    }
    arr.push({ at, v });
    if (arr.length > SNAPSHOT_CAP_PER_DAY) arr.splice(0, arr.length - SNAPSHOT_CAP_PER_DAY);
    fs.writeFileSync(file, JSON.stringify(arr));
    // 顺带清理过期快照（同目录下超过保留期的天文件）
    const cutoff = Date.now() - RETENTION_DAYS * 24 * 3600 * 1000;
    for (const f of fs.readdirSync(dir)) {
      if (!/^\d{4}-\d{2}-\d{2}\.json$/.test(f)) continue;
      if (new Date(f.slice(0, 10)).getTime() < cutoff) {
        try { fs.unlinkSync(path.join(dir, f)); } catch { /* 忽略 */ }
      }
    }
  } catch (e) {
    console.warn('[监控] 写快照失败（' + shopId + '/' + metric + '）:', e.message);
  }
}

/** 读取最近 days 天（含今天）的采样点，按时间升序 */
function readTrend(shopId, metric, days) {
  const dir = path.join(SNAPSHOT_DIR, String(shopId), String(metric));
  const points = [];
  try {
    if (!fs.existsSync(dir)) return points;
    const names = fs.readdirSync(dir).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
    const keep = names.slice(-Math.max(1, days || 7));
    for (const f of keep) {
      const arr = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      if (Array.isArray(arr)) for (const p of arr) if (p && typeof p.v === 'number') points.push({ at: p.at, v: p.v });
    }
  } catch (e) {
    console.warn('[监控] 读趋势失败（' + shopId + '/' + metric + '）:', e.message);
  }
  points.sort((a, b) => a.at - b.at);
  return points;
}

// ---------- meta（店铺名/最新值/采集状态，防抖落盘） ----------
let meta = readJson(META_FILE, { shops: {} });
if (!meta.shops || typeof meta.shops !== 'object') meta.shops = {};
let metaDirty = false;

function getMeta() {
  return meta;
}

/** 打补丁更新 meta 并防抖落盘 */
function patchMeta(fn) {
  try {
    fn(meta);
    metaDirty = true;
  } catch (e) {
    console.warn('[监控] 更新 meta 失败:', e.message);
  }
}

function flushMeta() {
  if (!metaDirty) return;
  metaDirty = false;
  writeJson(META_FILE, meta);
}

/** 清空监控数据（meta + 快照目录），供缓存清理调用；规则/店铺配置/金额模式保留。告警由 engine.clearAllAlerts 负责 */
function clearData() {
  meta = { shops: {} };
  metaDirty = true;
  flushMeta();
  try {
    fs.rmSync(SNAPSHOT_DIR, { recursive: true, force: true });
  } catch (e) {
    console.warn('[监控] 清空快照目录失败:', e.message);
  }
  ensureDirs();
}

// 防抖落盘定时器（unref 不阻塞进程退出）
const metaTimer = setInterval(flushMeta, 5000);
if (metaTimer.unref) metaTimer.unref();

module.exports = {
  getRules,
  getRulesById,
  setRuleOverrides,
  getExcludedShopIds,
  isMonitored,
  setExcludedShopIds,
  getCurrencyMode,
  setCurrencyMode,
  loadAlerts,
  saveAlerts,
  appendSample,
  readTrend,
  getMeta,
  patchMeta,
  flushMeta,
  clearData,
};
