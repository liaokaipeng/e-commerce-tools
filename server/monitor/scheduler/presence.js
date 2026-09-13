'use strict';
// 大屏在场租约管理：心跳/离开事件、授权或配置变化后的补采。
const { state } = require('./state');
const { isPresenceActive } = require('./lease');
const { refreshShops } = require('./registry');
const { tick } = require('./tick');

/**
 * 设置大屏在场状态（前端心跳/离开事件调用）。
 * 激活时立即刷新店铺状态并巡检一轮（不等 30s 定时器），让刚打开的大屏马上看到数据。
 */
function setPresence(active) {
  state.lastActiveAt = active ? Date.now() : 0;
  if (active && state.running) {
    refreshShops(); // 打开页面即同步最新授权状态（重新授权后立即生效）
    tick();
  }
  return isPresenceActive();
}

/** 开放平台授权变化（重新授权/新增/删除店铺）后由 openapi 路由调用：立即刷新店铺状态并补采 */
function notifyAuthChanged() {
  if (!state.running) return;
  refreshShops();
  if (isPresenceActive()) tick();
}

/** 监控店铺配置（排除名单）变化后调用：刷新各店 monitored 标记并立即补一轮巡检 */
function notifyConfigChanged() {
  if (!state.running) return;
  refreshShops();
  if (isPresenceActive()) tick();
}

module.exports = { isPresenceActive, setPresence, notifyAuthChanged, notifyConfigChanged };
