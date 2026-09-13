'use strict';
// 告警全量持久化（alerts.json，由引擎调用；含状态）。
const { ALERTS_FILE, readJson, writeJson } = require('./paths');

function loadAlerts() {
  const a = readJson(ALERTS_FILE, []);
  return Array.isArray(a) ? a : [];
}

function saveAlerts(alerts) {
  writeJson(ALERTS_FILE, alerts);
}

module.exports = { loadAlerts, saveAlerts };
