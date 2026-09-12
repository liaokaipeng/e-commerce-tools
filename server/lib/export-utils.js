'use strict';
/**
 * 导出类工具（竞价导出）共用的小工具：输出目录、文件名时间戳、Excel 表头样式。
 * 无网络依赖；原先这两处各自复制了一份「时间戳拼接 + mkdirSync + 表头加粗/冻结」样板。
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

/** 默认保存目录：用户「下载」目录（未填写目录时用，避免把导出文件写进程序目录） */
function defaultOutDir() {
  return path.join(os.homedir(), 'Downloads');
}

/** 确保目录存在并返回（入参为空时用默认下载目录）；创建失败抛友好错误 */
function ensureDir(dir) {
  const out = String(dir || '').trim() || defaultOutDir();
  try {
    fs.mkdirSync(out, { recursive: true });
  } catch (e) {
    throw new Error('无法创建保存目录：' + e.message);
  }
  return out;
}

/** 本地时间戳文本 YYYY-MM-DD_HHmmss（导出文件名用，避免同名覆盖） */
function timestampText(date = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`
    + `_${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`;
}

/** 统一 Excel 表头样式：首行加粗居中 + 冻结首行 */
function styleExcelHeader(ws) {
  const row = ws.getRow(1);
  row.font = { bold: true };
  row.alignment = { horizontal: 'center', vertical: 'middle' };
  ws.views = [{ state: 'frozen', ySplit: 1 }];
}

module.exports = { defaultOutDir, ensureDir, timestampText, styleExcelHeader };
