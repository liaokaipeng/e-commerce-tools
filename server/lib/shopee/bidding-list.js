'use strict';
/**
 * get_item_ongoing_list 的翻页收集（竞价导出 / 取消竞价共用）。
 * 两模块请求同一接口、仅 filter.page_tab 与行提取不同，原先各自维护一份相同的翻页循环。
 */
const { buildShopeeUrl, apiPost } = require('./client');

const PAGE_SIZE = 100;
const MAX_PAGES = 200; // 翻页上限（防死循环）

/**
 * 拉取指定 Tab 的竞价列表并翻页取全部。
 * @param {string} cookieHeader loadCookieHeader() 的产物
 * @param {object} o { shopId, region, pageTab, label, mapRows }
 * @param {(data: object) => Array} o.mapRows 每页行提取：入参为响应 data（含 list / has_more），返回本页行数组
 * @returns {Promise<{rows: Array, total: number}>} total 为接口的 total_model_count
 */
async function collectBiddingList(cookieHeader, { shopId, region, pageTab, label, mapRows }) {
  const url = buildShopeeUrl('/api/mkt/bidding/get_item_ongoing_list', { shopId, region });
  const rows = [];
  let pageNum = 1;
  let total = 0;
  while (true) {
    const j = await apiPost(url, cookieHeader, {
      filter: { page_tab: pageTab },
      page_info: { page_num: pageNum, page_size: PAGE_SIZE },
      option: { with_performance: true },
    }, { label });
    const d = j.data;
    total = d.total_model_count;
    rows.push(...mapRows(d));
    if (!d.has_more) break;
    pageNum += 1;
    if (pageNum > MAX_PAGES) throw new Error(`翻页超过 ${MAX_PAGES} 页，疑似死循环，已停止`);
  }
  return { rows, total };
}

module.exports = { collectBiddingList };
