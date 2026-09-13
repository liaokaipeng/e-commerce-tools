'use strict';
// 告警引擎入口：快照指标入库 → 规则评估 → 告警生命周期（去重/升级/回稳移出/关闭）→ SSE 广播。
// 告警只在大屏展示（本期不接 IM），页面经 /api/monitor/events 实时接收，迟到连接自动回放。
// 原单文件混杂 5 类职责，现拆到 engine/ 子目录，本入口只做编排/聚合（对外 API 不变）：
//   engine/state.js     内存态（告警数组 + 脏标记 + 查找）
//   engine/sse.js       SSE 传输（连接集合 / 事件回放 / 广播）
//   engine/render.js    告警展示渲染（明细归一化 / 消息生成 / 按模式重渲染）
//   engine/lifecycle.js 告警生命周期（ingest/maintain/systemFail/systemOk）
//   engine/actions.js   人工操作 + 查询投影 + 容量淘汰 + 清空
//   engine/persist.js   防抖落盘
const state = require('./state');
const sse = require('./sse');
const render = require('./render');
const lifecycle = require('./lifecycle');
const actions = require('./actions');
const persist = require('./persist');

module.exports = {
  // 生命周期
  ingest: lifecycle.ingest,
  maintain: lifecycle.maintain,
  systemFail: lifecycle.systemFail,
  systemOk: lifecycle.systemOk,
  // 人工操作 + 查询
  ackAlert: actions.ackAlert,
  closeAlert: actions.closeAlert,
  deleteAlert: actions.deleteAlert,
  closeShopAlerts: actions.closeShopAlerts,
  clearAllAlerts: actions.clearAllAlerts,
  getAlerts: actions.getAlerts,
  summary: actions.summary,
  // SSE 传输
  addClient: sse.addClient,
  removeClient: sse.removeClient,
  replayTo: sse.replayTo,
  broadcast: sse.broadcast,
  // 持久化
  flushAlerts: persist.flushAlerts,
  // 展示渲染
  renderAlertMessage: render.renderAlertMessage,
  shopCurrency: render.shopCurrency,
  _test: { alerts: state.alerts },
};
