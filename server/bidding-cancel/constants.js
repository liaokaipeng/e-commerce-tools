'use strict';
// 取消竞价常量。
// 待改进 Tab 的 page_tab 值（page_tab=1 为「进行中的竞价」全部，2 为其中「待改进」）
const PAGE_TAB_IMPROVE = 2;
// 逐条撤销之间的间隔，避免请求过快触发风控
const WITHDRAW_DELAY_MS = 300;

module.exports = { PAGE_TAB_IMPROVE, WITHDRAW_DELAY_MS };
