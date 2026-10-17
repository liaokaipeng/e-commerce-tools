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
  // data 回退为 json 时两者同一引用，去重避免同一对象白遍历一轮
  const pools = [resp, data, json].filter((p, i, a) => p && a.indexOf(p) === i);
  for (const pool of pools) {
    if (!pool || typeof pool !== 'object') continue;
    for (const k of keys) {
      if (Array.isArray(pool[k])) return pool[k];
    }
  }
  return [];
}

/**
 * 按 nameOf 取名计数，并按数量降序返回 [name, count] 列表（纯函数）。
 * 取代各域 parse 里四份同构的「按原因计数 → 降序」循环（处罚/问题商品/退货原因/差评关键词）。
 * @param {Array} list 原始记录列表
 * @param {(it: object) => (string|null)} nameOf 取分组名；返回空串/null 的项不计入
 */
function countByDesc(list, nameOf) {
  const cnt = {};
  for (const it of list || []) {
    if (!it || typeof it !== 'object') continue;
    const name = nameOf(it);
    if (name == null || name === '') continue;
    cnt[name] = (cnt[name] || 0) + 1;
  }
  return Object.entries(cnt).sort((a, b) => b[1] - a[1]);
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

module.exports = { snippet, detail, firstOf, round2, listOf, countByDesc, totalOf };
