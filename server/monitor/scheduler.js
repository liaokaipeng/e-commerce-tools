'use strict';
// 采集调度器入口：定时巡检已启用监控的授权店铺，按各域间隔把到期任务排入「每店串行队列」执行
// （同店不并发避免触发限频，跨店并发 ≤ MAX_SHOP_CONCURRENCY）。
// 采集成功：快照落盘 + 规则引擎入库 + meta 更新 + SSE 广播；
// 采集失败：连续失败计数并触发系统自检告警（engine.systemFail）。
// 未配置开放平台 App 或无已授权店铺时调度器空转，不发起任何网络请求。
// **按需采集**：仅当监控大屏页面打开（前端心跳报告在场）时才执行巡检；
// 离开页面即停采（前端发离开事件），心跳超时（PRESENCE_LEASE_MS）自动兜底停采。
// **监控开关**：店铺在监控配置（config.json 排除名单）之外的才采集，未启用监控的店铺跳过。
// 原单文件混杂在场租约/店铺注册表/采集执行/队列/手动触发/状态投影，现拆到 scheduler/ 子目录，
// 本入口只做编排/聚合（对外 API 不变）：
//   scheduler/config.js   调度常量
//   scheduler/state.js    内存态
//   scheduler/lease.js    在场租约判定
//   scheduler/registry.js 店铺注册表
//   scheduler/runner.js   单域采集执行
//   scheduler/queue.js    队列与并发闸门
//   scheduler/tick.js     巡检触发
//   scheduler/presence.js 在场心跳/授权与配置变化补采
//   scheduler/control.js  启停 / 手动触发 / 状态投影
const { state } = require('./scheduler/state');
const control = require('./scheduler/control');
const { tick } = require('./scheduler/tick');
const presence = require('./scheduler/presence');

module.exports = {
  start: control.start,
  stop: control.stop,
  tick,
  collectNow: control.collectNow,
  status: control.status,
  setPresence: presence.setPresence,
  isPresenceActive: presence.isPresenceActive,
  notifyAuthChanged: presence.notifyAuthChanged,
  notifyConfigChanged: presence.notifyConfigChanged,
  _state: state,
};
