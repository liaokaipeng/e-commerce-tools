'use strict';
// 单域采集执行：调用采集器 → 快照入库 / 引擎评估 / meta 更新 / 系统自检 / SSE 广播。
const { collectDomain, fetchShopInfo } = require('../collectors');
const { regionCurrency } = require('../currency');
const engine = require('../engine');
const store = require('../store');
const { state } = require('./state');
const { metaShop } = require('./registry');

/** 权限不足：该店该域不支持（App 未开通对应模块权限），按正常间隔退避、不计数失败、不触发系统自检告警 */
function handleUnsupported(shopId, domain, now, result) {
  state.lastRun[shopId] = state.lastRun[shopId] || {};
  state.lastRun[shopId][domain] = now;
  store.patchMeta((meta) => {
    if (!meta.shops[shopId]) meta.shops[shopId] = {};
    const m = meta.shops[shopId];
    if (!m.lastRun) m.lastRun = {};
    m.lastRun[domain] = now;
    if (!m.unsupported) m.unsupported = {};
    m.unsupported[domain] = { at: now, reason: String(result.reason || '无权限').slice(0, 200) };
  });
  engine.broadcast('collection', { shopId, domain, ok: true, skipped: 'unsupported', at: now, note: result.reason });
}

/** 指标入库：过滤数值 → 快照落盘 → meta 最新值 → 引擎评估 */
function persistMetrics(shopId, domain, now, result) {
  const metrics = {};
  for (const [k, v] of Object.entries(result.metrics || {})) {
    if (typeof v === 'number' && isFinite(v)) {
      metrics[k] = v;
      store.appendSample(shopId, k, v, now);
    }
  }
  if (Object.keys(metrics).length) {
    store.patchMeta((meta) => {
      if (!meta.shops[shopId]) meta.shops[shopId] = {};
      const m = meta.shops[shopId];
      if (!m.latest) m.latest = {};
      for (const [k, v] of Object.entries(metrics)) m.latest[k] = { v, at: now };
    });
    engine.ingest(shopId, domain, metrics, now, result.details);
  }
}

/** 首次采集时补店铺名与当地币种（get_shop_info 的 region → 货币代码；失败不阻断） */
async function ensureShopInfo(shopId) {
  const cur = metaShop(shopId);
  if (cur.name && cur.currency) return;
  const info = await fetchShopInfo(shopId);
  if (!info) return;
  store.patchMeta((meta) => {
    if (!meta.shops[shopId]) meta.shops[shopId] = {};
    const m = meta.shops[shopId];
    if (info.name) {
      m.name = info.name;
      const s = state.shops.find((x) => x.shopId === shopId);
      if (s) s.name = info.name;
    }
    if (info.region) m.currency = regionCurrency(info.region) || 'CNY';
    else if (!m.currency) m.currency = 'CNY'; // 接口无地区字段：按人民币处理，避免每轮重复拉取
  });
}

/** 采集成功收尾：清失败计数、记 lastRun、广播 */
function recordSuccess(shopId, domain, now, result) {
  store.patchMeta((meta) => {
    if (!meta.shops[shopId]) meta.shops[shopId] = {};
    const m = meta.shops[shopId];
    if (!m.lastRun) m.lastRun = {};
    m.lastRun[domain] = now;
    if (m.failCount) m.failCount[domain] = 0;
    m.consecutiveFails = 0;
  });
  state.lastRun[shopId] = state.lastRun[shopId] || {};
  state.lastRun[shopId][domain] = now;
  engine.broadcast('collection', { shopId, domain, ok: true, at: now, errors: result.errors || [] });
}

/** 采集失败收尾：记 lastRun（按正常间隔退避重试）、累计失败计数、触发系统自检告警、广播 */
function recordFailure(shopId, domain, now, e) {
  state.lastRun[shopId] = state.lastRun[shopId] || {};
  state.lastRun[shopId][domain] = now;
  store.patchMeta((meta) => {
    if (!meta.shops[shopId]) meta.shops[shopId] = {};
    const m = meta.shops[shopId];
    if (!m.lastRun) m.lastRun = {};
    m.lastRun[domain] = now;
    if (!m.failCount) m.failCount = {};
    m.failCount[domain] = (m.failCount[domain] || 0) + 1;
    m.consecutiveFails = (m.consecutiveFails || 0) + 1;
    if (!m.lastError) m.lastError = {};
    m.lastError[domain] = { at: now, message: String(e.message || e).slice(0, 300) };
  });
  engine.systemFail(shopId, domain, String(e.message || e), now);
  engine.broadcast('collection', { shopId, domain, ok: false, at: now, error: String(e.message || e) });
  console.warn(`[监控] 采集失败 ${shopId}/${domain}:`, e.message);
}

/** 执行单域采集（含快照入库/引擎评估/系统自检），返回是否成功 */
async function runJob(shopId, domain) {
  const key = shopId + ':' + domain;
  const now = Date.now();
  try {
    const result = await collectDomain(shopId, domain);
    // 权限不足：该店该域不支持（App 未开通对应模块权限）
    if (result.unsupported) {
      handleUnsupported(shopId, domain, now, result);
      return true;
    }
    persistMetrics(shopId, domain, now, result);
    engine.systemOk(shopId, now);
    await ensureShopInfo(shopId);
    recordSuccess(shopId, domain, now, result);
    return true;
  } catch (e) {
    // 失败也记 lastRun：按正常间隔退避重试，避免每个巡检周期（30s）都重复打失败的接口
    recordFailure(shopId, domain, now, e);
    return false;
  } finally {
    state.inFlight.delete(key);
    state.active = Math.max(0, state.active - 1);
  }
}

module.exports = { runJob };
