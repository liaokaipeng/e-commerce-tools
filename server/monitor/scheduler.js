'use strict';
// 采集调度器：定时巡检已授权店铺，按各域间隔把到期任务排入「每店串行队列」执行
// （同店不并发避免触发限频，跨店并发 ≤ MAX_SHOP_CONCURRENCY）。
// 采集成功：快照落盘 + 规则引擎入库 + meta 更新 + SSE 广播；
// 采集失败：连续失败计数并触发系统自检告警（engine.systemFail）。
// 未配置开放平台 App 或无已授权店铺时调度器空转，不发起任何网络请求。
// **按需采集**：仅当监控大屏页面打开（前端心跳报告在场）时才执行巡检；
// 离开页面即停采（前端发离开事件），心跳超时（PRESENCE_LEASE_MS）自动兜底停采。
const { JOBS } = require('./constants');
const { collectDomain, fetchShopName } = require('./collectors');
const engine = require('./engine');
const store = require('./store');
const openapiStore = require('../openapi/store');

const TICK_MS = 30 * 1000;
const MAX_SHOP_CONCURRENCY = 3;
// 大屏在场租约：前端每 30s 心跳一次，超过该时长未收到心跳视为离开（含浏览器崩溃兜底）
const PRESENCE_LEASE_MS = 75 * 1000;

const state = {
  running: false,
  timer: null,
  shops: [], // { shopId, name }
  lastRun: {}, // shopId -> { domain: at }
  queue: new Map(), // shopId -> 串行 Promise 链
  inFlight: new Set(), // `${shopId}:${domain}`
  active: 0,
  lastTickAt: 0,
  lastActiveAt: 0, // 最近一次「大屏在场」心跳（ms）；0=不在场
};

/** 是否处于「大屏在场」状态（心跳租约内） */
function isPresenceActive() {
  return Date.now() - state.lastActiveAt <= PRESENCE_LEASE_MS;
}

/**
 * 设置大屏在场状态（前端心跳/离开事件调用）。
 * 激活时立即刷新店铺状态并巡检一轮（不等 30s 定时器），让刚打开的大屏马上看到数据。
 */
function setPresence(active) {
  state.lastActiveAt = active ? Date.now() : 0;
  if (active && state.running) {
    refreshShops(); // 打开页面即同步最新授权状态（重新授权后立即生效）
    tick();
  }
  return isPresenceActive();
}

/** 开放平台授权变化（重新授权/新增/删除店铺）后由 openapi 路由调用：立即刷新店铺状态并补采 */
function notifyAuthChanged() {
  if (!state.running) return;
  refreshShops();
  if (isPresenceActive()) tick();
}

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
    const authBroken = s.state === 're_auth';
    if (authBroken) {
      // 凭证已死透的店铺停止采集；旧的「采集连续失败」告警关闭（界面以「待重新授权」呈现），
      // 重新授权后 collection 成功会重新开新告警（如有需要）
      engine.closeAlert(s.shopId + ':system.collect_fail');
    }
    return { shopId: s.shopId, name: (old && old.name) || metaShop(s.shopId).name || '', authBroken };
  });
  // 恢复内存中的最近执行时间（重启后避免立刻重复采集）
  if (!state.lastRun || !Object.keys(state.lastRun).length) {
    for (const s of state.shops) state.lastRun[s.shopId] = Object.assign({}, metaShop(s.shopId).lastRun);
  }
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

/** 巡检一次：仅在「大屏在场」时刷新店铺列表（每次巡检都做，纯本地无网络开销，授权变化 30s 内生效）+ 到期任务入队（授权失效的店铺跳过） */
function tick() {
  if (!state.running) return;
  const now = Date.now();
  state.lastTickAt = now;
  if (!isPresenceActive()) {
    return; // 大屏未打开：不巡检、不发任何请求
  }
  refreshShops();
  for (const shop of state.shops) {
    if (shop.authBroken) continue;
    const last = state.lastRun[shop.shopId] || {};
    for (const job of JOBS) {
      if (!last[job.domain] || now - last[job.domain] >= job.intervalMs) {
        enqueue(shop.shopId, job.domain);
      }
    }
  }
}

/** 启动调度器（默认随服务启动；大屏未打开/无 App/无店铺时空转不发请求） */
function start() {
  if (state.running) return;
  state.running = true;
  refreshShops();
  tick();
  state.timer = setInterval(tick, TICK_MS);
  if (state.timer.unref) state.timer.unref();
  if (state.shops.length) {
    console.log(`[监控] 采集调度已就绪：${state.shops.length} 个店铺，仅在大屏页面打开时按需巡检`);
  }
}

function stop() {
  state.running = false;
  if (state.timer) { clearInterval(state.timer); state.timer = null; }
}

/** 手动触发采集：指定店铺或全部店铺，强制立即入队（正在执行的跳过；授权失效的店铺跳过；隐含在场） */
function collectNow(shopId) {
  setPresence(true); // 手动采集必然发生在大屏打开时，顺便续期在场租约
  if (!state.shops.length) {
    const st = openapiStore.status();
    if (!st.configured) throw new Error('尚未配置开放平台 App，请先在「开放平台」页面完成配置与店铺授权');
    throw new Error('当前没有已授权的店铺');
  }
  const st = openapiStore.status();
  const targets = state.shops.filter((s) => {
    if (shopId && s.shopId !== shopId) return false;
    // 手动采集时用最新凭证状态复核（店铺列表每 5 分钟才刷新一次）
    const live = (st.shops || []).find((x) => x.shopId === s.shopId);
    if (live && live.state === 're_auth') {
      s.authBroken = true;
      return false;
    }
    if (live && s.authBroken) {
      s.authBroken = false; // 重新授权后即时恢复
    }
    return true;
  });
  if (shopId) {
    const s = state.shops.find((x) => x.shopId === shopId);
    if (!s) throw new Error('店铺 ' + shopId + ' 不在已授权列表中');
    if (!targets.length) {
      const live = (st.shops || []).find((x) => x.shopId === shopId);
      throw new Error(live && live.invalidReason
        ? `店铺 ${shopId} 授权已失效：${live.invalidReason}`
        : `店铺 ${shopId} 授权已失效，请重新授权后再采集`);
    }
  }
  const started = [];
  for (const s of targets) {
    for (const job of JOBS) {
      if (enqueue(s.shopId, job.domain)) started.push(s.shopId + ':' + job.domain);
    }
  }
  if (!started.length && !shopId) throw new Error('没有可采集的店铺（可能全部待重新授权），请先在「开放平台」页重新授权');
  return started;
}

/** 对外状态（大屏底部状态条用） */
function status() {
  return {
    running: state.running,
    tickMs: TICK_MS,
    lastTickAt: state.lastTickAt,
    active: state.active,
    presenceActive: isPresenceActive(),
    presenceLeaseMs: PRESENCE_LEASE_MS,
    shops: state.shops.map((s) => Object.assign({}, s, metaShop(s.shopId))),
  };
}

module.exports = {
  start, stop, tick, collectNow, status,
  setPresence, isPresenceActive, notifyAuthChanged, _state: state,
};
