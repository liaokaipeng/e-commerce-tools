'use strict';
// 采集调度器：定时巡检已授权店铺，按各域间隔把到期任务排入「每店串行队列」执行
// （同店不并发避免触发限频，跨店并发 ≤ MAX_SHOP_CONCURRENCY）。
// 采集成功：快照落盘 + 规则引擎入库 + meta 更新 + SSE 广播；
// 采集失败：连续失败计数并触发系统自检告警（engine.systemFail）。
// 未配置开放平台 App 或无已授权店铺时调度器空转，不发起任何网络请求。
const { JOBS } = require('./constants');
const { collectDomain, fetchShopName } = require('./collectors');
const engine = require('./engine');
const store = require('./store');
const openapiStore = require('../openapi/store');

const TICK_MS = 30 * 1000;
const SHOP_REFRESH_MS = 5 * 60 * 1000;
const MAX_SHOP_CONCURRENCY = 3;

const state = {
  running: false,
  timer: null,
  shops: [], // { shopId, name }
  lastRun: {}, // shopId -> { domain: at }
  queue: new Map(), // shopId -> 串行 Promise 链
  inFlight: new Set(), // `${shopId}:${domain}`
  active: 0,
  lastShopRefresh: 0,
  lastTickAt: 0,
};

function metaShop(shopId) {
  const meta = store.getMeta();
  const m = meta.shops[shopId] || {};
  return {
    name: m.name || '',
    lastRun: m.lastRun || {},
    failCount: m.failCount || {},
    consecutiveFails: m.consecutiveFails || 0,
  };
}

/** 从开放平台凭证读取已授权店铺（未配置 App 时返回空数组） */
function refreshShops() {
  const st = openapiStore.status();
  if (!st.configured) {
    state.shops = [];
    return;
  }
  const byId = new Map(state.shops.map((s) => [s.shopId, s]));
  state.shops = st.shops.map((s) => {
    const old = byId.get(s.shopId);
    return { shopId: s.shopId, name: (old && old.name) || metaShop(s.shopId).name || '' };
  });
  // 恢复内存中的最近执行时间（重启后避免立刻重复采集）
  if (!state.lastRun || !Object.keys(state.lastRun).length) {
    for (const s of state.shops) state.lastRun[s.shopId] = Object.assign({}, metaShop(s.shopId).lastRun);
  }
  state.lastShopRefresh = Date.now();
}

/** 执行单域采集（含快照入库/引擎评估/系统自检），返回是否成功 */
async function runJob(shopId, domain) {
  const key = shopId + ':' + domain;
  const now = Date.now();
  try {
    const result = await collectDomain(shopId, domain);
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
      engine.ingest(shopId, domain, metrics, now);
    }
    engine.systemOk(shopId, now);
    // 首次采集时补店铺名（失败不阻断）
    if (!metaShop(shopId).name) {
      const name = await fetchShopName(shopId);
      if (name) store.patchMeta((meta) => {
        if (!meta.shops[shopId]) meta.shops[shopId] = {};
        meta.shops[shopId].name = name;
        const s = state.shops.find((x) => x.shopId === shopId);
        if (s) s.name = name;
      });
    }
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
    return true;
  } catch (e) {
    // 失败也记 lastRun：按正常间隔退避重试，避免每个巡检周期（30s）都重复打失败的接口
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
    return false;
  } finally {
    state.inFlight.delete(key);
    state.active = Math.max(0, state.active - 1);
  }
}

/** 入队（同店串行；已在执行或已排队则跳过） */
function enqueue(shopId, domain) {
  const key = shopId + ':' + domain;
  if (state.inFlight.has(key)) return false;
  if (!state.shops.some((s) => s.shopId === shopId)) return false;
  state.inFlight.add(key);
  const prev = state.queue.get(shopId) || Promise.resolve();
  const task = prev.then(async () => {
    // 跨店并发闸门：等待名额再执行
    while (state.active >= MAX_SHOP_CONCURRENCY) await new Promise((r) => setTimeout(r, 500));
    state.active += 1;
    try {
      await runJob(shopId, domain);
    } catch (e) {
      console.warn('[监控] 任务执行异常:', e.message);
    }
  }).catch(() => { /* runJob 已兜底，双保险 */ });
  state.queue.set(shopId, task);
  return true;
}

/** 巡检一次：刷新店铺列表（周期）+ 到期任务入队 */
function tick() {
  if (!state.running) return;
  const now = Date.now();
  if (now - state.lastShopRefresh >= SHOP_REFRESH_MS) refreshShops();
  state.lastTickAt = now;
  for (const shop of state.shops) {
    const last = state.lastRun[shop.shopId] || {};
    for (const job of JOBS) {
      if (!last[job.domain] || now - last[job.domain] >= job.intervalMs) {
        enqueue(shop.shopId, job.domain);
      }
    }
  }
}

/** 启动调度器（默认随服务启动；无 App/无店铺时空转不发请求） */
function start() {
  if (state.running) return;
  state.running = true;
  refreshShops();
  tick();
  state.timer = setInterval(tick, TICK_MS);
  if (state.timer.unref) state.timer.unref();
  if (state.shops.length) {
    console.log(`[监控] 采集调度已启动：${state.shops.length} 个店铺，每 ${TICK_MS / 1000}s 巡检`);
  }
}

function stop() {
  state.running = false;
  if (state.timer) { clearInterval(state.timer); state.timer = null; }
}

/** 手动触发采集：指定店铺或全部店铺，强制立即入队（正在执行的跳过） */
function collectNow(shopId) {
  if (!state.shops.length) {
    const st = openapiStore.status();
    if (!st.configured) throw new Error('尚未配置开放平台 App，请先在「开放平台」页面完成配置与店铺授权');
    throw new Error('当前没有已授权的店铺');
  }
  const targets = shopId ? state.shops.filter((s) => s.shopId === shopId) : state.shops;
  if (shopId && !targets.length) throw new Error('店铺 ' + shopId + ' 不在已授权列表中');
  const started = [];
  for (const s of targets) {
    for (const job of JOBS) {
      if (enqueue(s.shopId, job.domain)) started.push(s.shopId + ':' + job.domain);
    }
  }
  return started;
}

/** 对外状态（大屏底部状态条用） */
function status() {
  return {
    running: state.running,
    tickMs: TICK_MS,
    lastTickAt: state.lastTickAt,
    active: state.active,
    shops: state.shops.map((s) => Object.assign({}, s, metaShop(s.shopId))),
  };
}

module.exports = { start, stop, tick, collectNow, status, _state: state };
