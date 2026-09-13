'use strict';
/** 通用延时（毫秒） */
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

module.exports = { sleep };
