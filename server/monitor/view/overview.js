'use strict';
// 大屏总览视图投影：店铺列表（仅启用监控的店铺；含告警计数/最高级别/矩阵定级/授权状态）+ 全局统计。
// 供 monitor.js 的 GET /api/monitor/overview 直接取用，路由层只负责 sendJson。
const { METRICS } = require('../constants');
const store = require('../store');
const engine = require('../engine');
const scheduler = require('../scheduler');
const { shopView } = require('../view');
const openapiStore = require('../../openapi/store');

/** 组装总览响应体 */
function buildOverview() {
  const openapiStatus = openapiStore.status();
  const sched = scheduler.status();
  const monitoredSet = new Set(sched.shops.filter((s) => s.monitored).map((s) => s.shopId));
  const sum = engine.summary(monitoredSet);
  const shops = sched.shops.filter((s) => s.monitored).map((s) => {
    const alerts = sum.byShop[s.shopId] || { P0: 0, P1: 0, P2: 0, maxLevel: null };
    return Object.assign(shopView(s.shopId, s.name), { alerts, authBroken: !!s.authBroken });
  });
  return {
    ok: true,
    configured: openapiStatus.configured,
    scheduler: { running: sched.running, active: sched.active, lastTickAt: sched.lastTickAt, presenceActive: sched.presenceActive },
    totals: sum.totals,
    reAuthCount: shops.filter((s) => s.authBroken).length,
    excludedCount: sched.shops.length - shops.length,
    currencyMode: store.getCurrencyMode(),
    metrics: METRICS,
    shops,
    at: Date.now(),
  };
}

module.exports = { buildOverview };
