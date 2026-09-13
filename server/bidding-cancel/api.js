'use strict';
// 取消竞价接口调用层（URL 拼接与请求层见 lib/shopee-session.js）。
const { apiPost, buildShopeeUrl } = require('../lib/shopee-session');
const { PAGE_TAB_IMPROVE } = require('./constants');
const { extractImprovementItems } = require('./parse');

/**
 * 拉取「待改进」竞价列表（page_tab=2），翻页取全部。
 * @returns {Array<{itemId, itemName, modelId, modelName, bidId, price, suggestedPrice}>}
 */
async function fetchImprovementBids(cookieHeader, shopId, region) {
  const url = buildShopeeUrl('/api/mkt/bidding/get_item_ongoing_list', { shopId, region });
  const rows = [];
  let pageNum = 1;
  while (true) {
    const j = await apiPost(url, cookieHeader, {
      filter: { page_tab: PAGE_TAB_IMPROVE },
      page_info: { page_num: pageNum, page_size: 100 },
      option: { with_performance: true },
    }, { label: '获取待改进列表' });
    const d = j.data;
    rows.push(...extractImprovementItems(d));
    if (!d.has_more) break;
    pageNum += 1;
    if (pageNum > 200) throw new Error('翻页超过 200 页，疑似死循环，已停止');
  }
  return rows;
}

/** 撤销一条竞价（seller_withdraw） */
async function withdrawBid(cookieHeader, shopId, region, bidId) {
  const url = buildShopeeUrl('/api/mkt/bidding/seller_withdraw', { shopId, region });
  return apiPost(url, cookieHeader, { bid_id: String(bidId) }, { label: '撤销竞价' });
}

module.exports = { fetchImprovementBids, withdrawBid };
