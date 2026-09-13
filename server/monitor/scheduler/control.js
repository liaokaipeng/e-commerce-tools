'use strict';
// 调度控制：启停、手动触发采集、对外状态投影。
const { JOBS } = require('../constants');
const { TICK_MS, PRESENCE_LEASE_MS } = require('./config');
const { ensureRates } = require('../currency');
const openapiStore = require('../../openapi/store');
const { state } = require('./state');
const { refreshShops, metaShop } = require('./registry');
const { enqueue } = require('./queue');
const { tick } = require('./tick');
const { setPresence, isPresenceActive } = require('./presence');

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
    ensureRates(); // 有店铺时懒加载汇率（在线拉取失败自动回退内置静态表；无店铺不发外部请求）
  }
}

function stop() {
  state.running = false;
  if (state.timer) { clearInterval(state.timer); state.timer = null; }
}

/** 手动触发采集：指定店铺或全部店铺，强制立即入队（正在执行的跳过；未启用监控/授权失效的店铺跳过；隐含在场） */
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
    if (!s.monitored) return false; // 未启用监控的店铺不采集
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
    if (!s.monitored) throw new Error(`店铺 ${shopId} 未启用监控，请先在大屏「监控店铺」配置中勾选`);
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
  if (!started.length && !shopId) throw new Error('没有可采集的店铺（可能全部未启用监控或待重新授权），请检查大屏「监控店铺」配置与授权状态');
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

module.exports = { start, stop, collectNow, status };
