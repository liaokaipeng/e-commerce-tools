'use strict';
/**
 * 日期/时间格式化基础件：统一各处重复实现的「两位补零」与本地日期文本。
 * 各业务格式化（导出时间戳、包时间戳等）格式不同，保留在各自模块，只复用这里的补零与日期口径。
 */

/** 两位补零 */
function pad2(n) {
  return String(n).padStart(2, '0');
}

/** 本地日期 YYYY-MM-DD（入参为毫秒时间戳或 Date，缺省为当前时间） */
function ymd(ms = Date.now()) {
  const d = ms instanceof Date ? ms : new Date(ms);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

module.exports = { pad2, ymd };
