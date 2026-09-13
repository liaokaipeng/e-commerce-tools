'use strict';
// 授权状态变化后通知监控大屏调度器立即刷新店铺列表（重新授权后无需等巡检周期，大屏当场恢复）。
function notifyMonitorAuthChanged() {
  try {
    require('../monitor/scheduler').notifyAuthChanged();
  } catch { /* 监控模块未加载时忽略 */ }
}

module.exports = { notifyMonitorAuthChanged };
