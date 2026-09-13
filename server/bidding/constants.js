'use strict';
// 竞价导出常量。
const PAGE_SIZE = 100;
const MAX_PAGES = 200;   // 翻页上限（防死循环）
const WINNING_TAB = 3;   // get_item_ongoing_list 的 filter.page_tab=3 即「获胜」

module.exports = { PAGE_SIZE, MAX_PAGES, WINNING_TAB };
