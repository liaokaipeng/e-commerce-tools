'use strict';
// 采集响应通用工具：文本截断 / 明细组装 / 字段兜底取值 / 列表与总数提取 / 保留两位。
// 全部为无副作用纯函数（便于单测），不发起任何请求。
const { SNIPPET_MAX } = require('../constants');

/** 截断长文本（明细行展示用） */
function snippet(s, n) {
  const max = n || SNIPPET_MAX;
  const t = String(s == null ? '' : s).trim();
  return t.length > max ? t.slice(0, max) + '…' : t;
}

/** 组装明细对象：text 拼进告警消息（可为空），rows 进大屏告警详情抽屉 */
function detail(text, rows) {
  return { text: text || '', rows: Array.isArray(rows) ? rows : [] };
}

/** 提取对象里第一个非空字段值（接口字段未实测时多键兜底） */
function firstOf(obj, keys) {
  for (const k of keys) {
    const v = obj ? obj[k] : undefined;
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return null;
}

const round2 = (n) => Math.round(n * 100) / 100;

/** 取响应里的通用列表（response/response.data/顶层多字段兜底） */
function listOf(json, keys) {
  if (!json || typeof json !== 'object') return [];
  const resp = json.response && typeof json.response === 'object' ? json.response : null;
  const data = json.data && typeof json.data === 'object' ? json.data : json;
  const pools = [resp, data, json];
  for (const pool of pools) {
    if (!pool || typeof pool !== 'object') continue;
    for (const k of keys) {
      if (Array.isArray(pool[k])) return pool[k];
    }
  }
  return [];
}

/** 取响应总数（total_count / total / count 等），无则 null */
function totalOf(json) {
  if (!json || typeof json !== 'object') return null;
  const resp = json.response && typeof json.response === 'object' ? json.response : json;
  for (const k of ['total_count', 'total', 'count']) {
    const v = resp[k];
    if (typeof v === 'number' && isFinite(v)) return v;
    if (typeof v === 'string' && v !== '' && isFinite(Number(v))) return Number(v);
  }
  return null;
}

module.exports = { snippet, detail, firstOf, round2, listOf, totalOf };
