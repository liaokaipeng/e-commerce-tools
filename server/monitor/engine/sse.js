'use strict';
// SSE 传输层：连接集合 + 事件回放缓存 + 广播/回放。
// 大屏页面经 /api/monitor/events 实时接收，迟到连接自动回放最近事件。
const { EVENT_LOG_CAP } = require('../constants');

const clients = new Set();
const eventLog = [];

/** SSE 数据行（广播与回放共用同一拼装口径） */
const sseLine = (ev) => `data: ${JSON.stringify(ev)}\n\n`;

function broadcast(type, data) {
  const ev = { type, data, at: Date.now() };
  eventLog.push(ev);
  if (eventLog.length > EVENT_LOG_CAP) eventLog.splice(0, eventLog.length - EVENT_LOG_CAP);
  const line = sseLine(ev);
  for (const res of clients) {
    try { res.write(line); } catch { /* 连接已断 */ }
  }
}

function addClient(res) {
  clients.add(res);
}

function removeClient(res) {
  clients.delete(res);
}

function replayTo(res) {
  for (const ev of eventLog) {
    try { res.write(sseLine(ev)); } catch { /* 忽略 */ }
  }
}

module.exports = { broadcast, addClient, removeClient, replayTo };
