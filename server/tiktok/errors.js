'use strict';
// 网络错误分类（用于提示用户开启 VPN）
const { NETWORK_PATTERNS } = require('./constants');

/** 判断错误是否为网络问题（用于提示开启 VPN） */
function isNetworkError(e) {
  const msg = String(e?.message || e).toLowerCase();
  return NETWORK_PATTERNS.some((p) => msg.includes(p));
}

module.exports = { isNetworkError };
