'use strict';
// 告警引擎内存态：告警数组 + 脏标记 + 常用查找。所有子模块共享同一数组引用并原地修改（splice/sort），
// 以便 engine._test.alerts 与各子模块看到同一份数据（不可整体重新赋值）。
const store = require('../store');

// 兼容旧落盘数据：历史上的「已恢复」状态记录直接丢弃（该状态已整体移除）
// [{ id, seq, shopId, ruleId, domain, metric, title, unit, level, status, current, count, firstAt, lastAt, updatedAt, suggest, message }]
const alerts = store.loadAlerts().filter((a) => a.status !== 'recovered');
let alertsDirty = false;

function markDirty() {
  alertsDirty = true;
}

function isDirty() {
  return alertsDirty;
}

function markClean() {
  alertsDirty = false;
}

/** 按 (shopId, ruleId) 找告警记录 */
function findAlert(shopId, ruleId) {
  return alerts.find((a) => a.shopId === shopId && a.ruleId === ruleId);
}

/** 按告警 id 找记录 */
function findById(id) {
  return alerts.find((x) => x.id === id);
}

/** 按告警 id 找下标（不存在返回 -1） */
function indexById(id) {
  return alerts.findIndex((x) => x.id === id);
}

/** 告警对象在数组中的下标（不存在返回 -1） */
function indexOfAlert(a) {
  return alerts.indexOf(a);
}

module.exports = {
  alerts,
  markDirty,
  isDirty,
  markClean,
  findAlert,
  findById,
  indexById,
  indexOfAlert,
};
