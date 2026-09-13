'use strict';
// 调度器内存态（各子模块共享同一对象引用，原地修改字段）。
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

module.exports = { state };
