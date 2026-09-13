'use strict';
// 告警落盘：防抖（5 秒内多次变更合并写一次）。
const store = require('../store');
const state = require('./state');

/** 落盘（防抖：5 秒内多次变更合并写一次） */
function flushAlerts() {
  if (!state.isDirty()) return;
  state.markClean();
  store.saveAlerts(state.alerts);
}

const flushTimer = setInterval(flushAlerts, 5000);
if (flushTimer.unref) flushTimer.unref();

module.exports = { flushAlerts };
