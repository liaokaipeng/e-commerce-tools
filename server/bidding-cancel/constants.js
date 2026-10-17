'use strict';
// 取消竞价常量。
// 待改进 Tab 的 page_tab 值（page_tab=1 为「进行中的竞价」全部，2 为其中「待改进」）
const PAGE_TAB_IMPROVE = 2;
// 翻页口径（与竞价导出 bidding/constants.js 一致：同一接口同一分页规则）
const PAGE_SIZE = 100;
const MAX_PAGES = 200;
// 逐条撤销之间的间隔，避免请求过快触发风控
const WITHDRAW_DELAY_MS = 300;

module.exports = { PAGE_TAB_IMPROVE, PAGE_SIZE, MAX_PAGES, WITHDRAW_DELAY_MS };
