'use strict';
// 取消竞价接口调用层（URL 拼接与请求层见 lib/shopee-session.js）。
const { collectBiddingList, buildShopeeUrl, apiPost } = require('../lib/shopee-session');
const { PAGE_TAB_IMPROVE } = require('./constants');
const { extractImprovementItems } = require('./parse');

/**
 * 拉取「待改进」竞价列表（page_tab=2），翻页取全部。
 * @returns {Array<{itemId, itemName, modelId, modelName, bidId, price, suggestedPrice}>}
 */
async function fetchImprovementBids(cookieHeader, shopId, region) {
  const { rows } = await collectBiddingList(cookieHeader, {
    shopId,
    region,
    pageTab: PAGE_TAB_IMPROVE,
    label: '获取待改进列表',
    mapRows: extractImprovementItems,
  });
  return rows;
}

/** 撤销一条竞价（seller_withdraw） */
async function withdrawBid(cookieHeader, shopId, region, bidId) {
  const url = buildShopeeUrl('/api/mkt/bidding/seller_withdraw', { shopId, region });
  return apiPost(url, cookieHeader, { bid_id: String(bidId) }, { label: '撤销竞价' });
}

module.exports = { fetchImprovementBids, withdrawBid };
