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

/** 打印美化 JSON 到 stdout */
function print(value) {
  process.stdout.write(JSON.stringify(value, null, 2) + '\n');
}

/** 打印错误 JSON 到 stderr 并置退出码 1（不抛异常，避免堆栈污染输出） */
function fail(message, hint) {
  const payload = { ok: false, error: String(message || '未知错误') };
  if (hint) payload.hint = String(hint);
  process.stderr.write(JSON.stringify(payload, null, 2) + '\n');
  process.exitCode = 1;
}

module.exports = { extractPayload, print, fail };
