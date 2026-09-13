'use strict';
/** 视频上传公共行校验与「跳过该行」错误（cn / ph 共用） */
const fs = require('fs');

// 前端 video 页有同名的即时预览校验，文案/阈值需保持一致
const CAPTION_MAX_LENGTH = 250;
function validateUploadRow(row) {
  if (!row.path) return '缺少视频路径';
  if (row.caption && row.caption.length > CAPTION_MAX_LENGTH) return `视频说明超过${CAPTION_MAX_LENGTH}字符，请精简后再上传`;
  if (row.caption && /tiktok/i.test(row.caption)) return '视频说明不能包含 tiktok 字样';
  let st;
  try {
    st = fs.statSync(row.path);
  } catch (e) {
    return `表格中填写的视频文件不存在，请检查路径是否正确: ${row.path}`;
  }
  if (st.isDirectory()) return `表格中填写的是文件夹而不是视频文件，请检查路径: ${row.path}`;
  if (st.size === 0) return `视频文件内容为空（0 字节），请检查文件是否损坏: ${row.path}`;
  return '';
}

/** 构造「跳过该行不上传」的错误：processJob 捕获后会在 row-error 事件带 skip 标记，前端状态列显示「失败，商品为空」 */
function skipError(message) {
  const e = new Error(message);
  e.skip = true;
  return e;
}

module.exports = {
  validateUploadRow,
  skipError,
  CAPTION_MAX_LENGTH,
};
