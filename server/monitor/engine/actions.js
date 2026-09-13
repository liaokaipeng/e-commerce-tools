'use strict';
// 人工操作 + 查询投影 + 容量淘汰 + 清空：对告警内存态的人工干预与读取。
const { ALERT_CAP, LEVEL_ORDER } = require('../constants');
const { isMoreSevere } = require('../rules');
const { broadcast } = require('./sse');
const state = require('./state');
const { flushAlerts } = require('./persist');

/** 人工确认告警 */
function ackAlert(id) {
  const a = state.findById(id);
  if (!a) return null;
  a.status = 'ack';
  a.updatedAt = Date.now();
  state.markDirty();
  broadcast('alert', Object.assign({}, a, { change: 'ack' }));
  return Object.assign({}, a);
}

/** 人工关闭告警（终端态；再次触发会重新打开）。已关闭时幂等返回，不重复广播。 */
function closeAlert(id) {
  const a = state.findById(id);
  if (!a) return null;
  if (a.status === 'closed') return Object.assign({}, a);
  a.status = 'closed';
  a.updatedAt = Date.now();
  state.markDirty();
  broadcast('alert', Object.assign({}, a, { change: 'close' }));
  return Object.assign({}, a);
}

/**
 * 人工删除告警：从内存与落盘移除（区别于 closeAlert 的「终端态保留」）。
 * 大屏上以「删除」为唯一人工操作；删除后下一轮采集若仍异常会重新触发（计数重新起算）。
 * 已不存在时返回 null（幂等）。
 */
function deleteAlert(id) {
  const i = state.indexById(id);
  if (i < 0) return null;
  const [a] = state.alerts.splice(i, 1);
  state.markDirty();
  broadcast('alert', Object.assign({}, a, { change: 'delete' }));
  // 返回值同样带 change:'delete'（与 SSE 事件形态一致）：路由把它随响应发回发起页面，
  // 前端 upsertAlert 据此移除；不带的话响应回填会把刚删除的告警塞回列表（「闪回」bug）
  return Object.assign({}, a, { change: 'delete' });
}

/** 关闭某店铺全部未关闭告警（停用监控时调用，重新启用后触发会重新打开），返回关闭条数 */
function closeShopAlerts(shopId) {
  let n = 0;
  for (const a of state.alerts) {
    if (a.shopId !== shopId || a.status === 'closed') continue;
    a.status = 'closed';
    a.updatedAt = Date.now();
    broadcast('alert', Object.assign({}, a, { change: 'close' }));
    n += 1;
  }
  if (n) state.markDirty();
  return n;
}

/** 清空全部告警（内存 + 落盘 + 广播 reset），供缓存清理调用；注意原地清空（_test 持有同一数组引用） */
function clearAllAlerts() {
  state.alerts.splice(0, state.alerts.length);
  state.markDirty();
  flushAlerts();
  broadcast('reset', { at: Date.now() });
}

/** 容量控制：超出上限时淘汰最旧的已关闭记录，其次最旧 P2 */
function prune() {
  const alerts = state.alerts;
  if (alerts.length <= ALERT_CAP) return;
  const rank = (a) => (a.status === 'closed' ? 0 : LEVEL_ORDER[a.level] || 1);
  alerts.sort((a, b) => rank(a) - rank(b) || a.lastAt - b.lastAt);
  const removed = alerts.splice(0, alerts.length - ALERT_CAP);
  if (removed.length) console.log(`[监控] 告警超过 ${ALERT_CAP} 条，淘汰 ${removed.length} 条最旧记录`);
}

/** 查询告警（默认含 open/ack，closed 需显式指定） */
function getAlerts({ level, shopId, status, limit } = {}) {
  let list = state.alerts.slice();
  if (level) list = list.filter((a) => a.level === level);
  if (shopId) list = list.filter((a) => a.shopId === shopId);
  if (status) list = list.filter((a) => a.status === status);
  else list = list.filter((a) => a.status !== 'closed');
  // 排序：级别从重到轻 → 更新时间从新到旧
  list.sort((a, b) => (LEVEL_ORDER[b.level] || 0) - (LEVEL_ORDER[a.level] || 0) || b.updatedAt - a.updatedAt);
  if (limit && limit > 0) list = list.slice(0, limit);
  return list.map((a) => Object.assign({}, a));
}

/** 汇总：各店各级别未关闭告警数与最高级别，以及全局总数。可传 onlyShopIds（Set）只统计启用监控的店铺。 */
function summary(onlyShopIds) {
  const totals = { P0: 0, P1: 0, P2: 0 };
  const byShop = {};
  for (const a of state.alerts) {
    if (a.status === 'closed') continue;
    if (onlyShopIds && !onlyShopIds.has(a.shopId)) continue;
    totals[a.level] += 1;
    if (!byShop[a.shopId]) byShop[a.shopId] = { P0: 0, P1: 0, P2: 0, maxLevel: null };
    byShop[a.shopId][a.level] += 1;
    if (!byShop[a.shopId].maxLevel || isMoreSevere(a.level, byShop[a.shopId].maxLevel)) {
      byShop[a.shopId].maxLevel = a.level;
    }
  }
  return { totals, byShop };
}

module.exports = {
  ackAlert,
  closeAlert,
  deleteAlert,
  closeShopAlerts,
  clearAllAlerts,
  prune,
  getAlerts,
  summary,
};
