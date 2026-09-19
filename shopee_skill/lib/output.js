'use strict';
// 输出与错误处理：所有命令统一输出合法 JSON（便于管道 / agent 解析），错误写 stderr 并置非零退出码。
// 载荷解包口径与 server/openapi/client/parse.js 一致：优先 response，其次 data，最后顶层。
function extractPayload(raw) {
  if (raw && typeof raw === 'object') {
    const r = raw.response;
    if (isPayload(r)) return r;
    const d = raw.data;
    if (isPayload(d)) return d;
  }
  return raw;
}

/** 非空对象 / 数组视为有效载荷（空对象视为「没有该层」） */
function isPayload(v) {
  if (v === undefined || v === null || v === '') return false;
  if (typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 0) return false;
  return true;
}

/**
 * 打印 JSON 到 stdout。
 * @param {*} value 任意可序列化值
 * @param {object} [opts] { compact?: boolean } compact 时不加缩进，省 token（适合 agent / 管道）
 */
function print(value, opts) {
  const compact = !!(opts && opts.compact);
  process.stdout.write(JSON.stringify(value, null, compact ? 0 : 2) + '\n');
}

/** 打印错误 JSON 到 stderr 并置退出码 1（不抛异常，避免堆栈污染输出） */
function fail(message, hint) {
  const payload = { ok: false, error: String(message || '未知错误') };
  if (hint) payload.hint = String(hint);
  process.stderr.write(JSON.stringify(payload, null, 2) + '\n');
  process.exitCode = 1;
}

/** 打印一条提示/警告到 stderr（单行 JSON；不污染 stdout 的数据输出，管道依旧可解析） */
function warn(note) {
  process.stderr.write(JSON.stringify({ warning: String(note) }) + '\n');
}

/**
 * 按点分路径取值，数字段可作数组下标：orders.0.order_sn / response.a.2.b。
 * 取不到返回 undefined（由调用方决定是否报错）。
 */
function selectPath(value, dotted) {
  const pathStr = String(dotted == null ? '' : dotted).trim();
  if (!pathStr) return value;
  let cur = value;
  for (const seg of pathStr.split('.')) {
    if (seg === '') continue;
    if (cur === null || cur === undefined) return undefined;
    if (Array.isArray(cur)) {
      const idx = Number(seg);
      if (!Number.isInteger(idx) || idx < 0) return undefined;
      cur = cur[idx];
    } else if (typeof cur === 'object') {
      if (!Object.prototype.hasOwnProperty.call(cur, seg)) return undefined;
      cur = cur[seg];
    } else {
      return undefined;
    }
  }
  return cur;
}

/**
 * 按 --fields 裁剪输出字段（省 token）：逗号分隔字段名。
 * 对象只保留指定字段；数组逐元素裁剪（元素非对象时原样保留）；标量原样返回。
 * 与 --select 配合使用：--select orders --fields order_sn,total_amount。
 */
function pickFields(value, csv) {
  const names = String(csv == null ? '' : csv).split(',').map((s) => s.trim()).filter(Boolean);
  if (!names.length) return value;
  if (Array.isArray(value)) {
    return value.map((v) => (v && typeof v === 'object' && !Array.isArray(v) ? pickFields(v, csv) : v));
  }
  if (value && typeof value === 'object') {
    const out = {};
    for (const n of names) {
      if (Object.prototype.hasOwnProperty.call(value, n)) out[n] = value[n];
    }
    return out;
  }
  return value;
}

module.exports = { extractPayload, print, fail, warn, selectPath, pickFields };
