'use strict';
// 大屏在场租约判定（独立成模块，避免 tick / presence 相互 require 成环）。
const { PRESENCE_LEASE_MS } = require('./config');
const { state } = require('./state');

/** 是否处于「大屏在场」状态（心跳租约内） */
function isPresenceActive() {
  return Date.now() - state.lastActiveAt <= PRESENCE_LEASE_MS;
}

module.exports = { isPresenceActive };
