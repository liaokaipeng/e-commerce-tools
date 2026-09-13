'use strict';
// 采集侧日期格式化与单号日期解析（补零复用 lib/date-utils）。
const { pad2 } = require('../../../lib/date-utils');

/** Unix 秒 → 'YYYY-MM-DD HH:mm'（无效值返回空串） */
function fmtSec(ts) {
  const n = Number(ts);
  if (!isFinite(n) || n <= 0) return '';
  const d = new Date(n * 1000);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** order_sn 前缀 YYMMDD → 本地 0 点 Date（订单号如 260816G8NXB128 含创建日期） */
function orderSnDate(sn) {
  const m = /^(\d{2})(\d{2})(\d{2})/.exec(String(sn || ''));
  if (!m) return null;
  return new Date(2000 + Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/** order_sn 的 YYMMDD → 'YYYY-MM-DD'（解析失败返回空串） */
function snDateText(sn) {
  const d = orderSnDate(sn);
  if (!d) return '';
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** 广告接口日期格式 DD-MM-YYYY（官方要求，与订单/商品模块的 Unix 秒不同） */
function formatDdMmYyyy(date) {
  const d = date || new Date();
  return `${pad2(d.getDate())}-${pad2(d.getMonth() + 1)}-${d.getFullYear()}`;
}

module.exports = { fmtSec, orderSnDate, snDateText, formatDdMmYyyy };
