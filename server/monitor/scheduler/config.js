'use strict';
// 采集调度配置常量。
const TICK_MS = 30 * 1000;
const MAX_SHOP_CONCURRENCY = 3;
// 大屏在场租约：前端每 30s 心跳一次，超过该时长未收到心跳视为离开（含浏览器崩溃兜底）
const PRESENCE_LEASE_MS = 75 * 1000;

module.exports = { TICK_MS, MAX_SHOP_CONCURRENCY, PRESENCE_LEASE_MS };
