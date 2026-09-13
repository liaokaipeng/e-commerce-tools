'use strict';
// 巡检触发：仅在「大屏在场」时刷新店铺列表 + 把到期任务入队（授权失效的店铺跳过）。
const { JOBS } = require('../constants');
const { state } = require('./state');
const { isPresenceActive } = require('./lease');
const { refreshShops } = require('./registry');
const { enqueue } = require('./queue');

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
    if (shop.authBroken || !shop.monitored) continue;
    const last = state.lastRun[shop.shopId] || {};
    for (const job of JOBS) {
      if (!last[job.domain] || now - last[job.domain] >= job.intervalMs) {
        enqueue(shop.shopId, job.domain);
      }
    }
  }
}

module.exports = { tick };
