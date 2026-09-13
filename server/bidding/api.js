'use strict';
// 竞价数据抓取（纯 HTTP，请求层见 lib/shopee-session.js）。
const { toAmount, apiPost, buildShopeeUrl } = require('../lib/shopee-session');
const { PAGE_SIZE, MAX_PAGES, WINNING_TAB } = require('./constants');

/** 拉取【获胜】竞价数据（page_tab=3），翻页取全部，返回归一化行与总数 */
async function fetchWinningData(cookieHeader, shopId, region) {
  const url = buildShopeeUrl('/api/mkt/bidding/get_item_ongoing_list', { shopId, region });
  const rows = [];
  let pageNum = 1;
  let total = 0;
  while (true) {
    const j = await apiPost(url, cookieHeader, {
      filter: { page_tab: WINNING_TAB },
      page_info: { page_num: pageNum, page_size: PAGE_SIZE },
      option: { with_performance: true },
    }, { label: '获取获胜竞价列表' });
    const d = j.data;
    total = d.total_model_count;
    for (const item of d.list) {
      for (const model of item.model_list) {
        const b = model.bidding_info || {};
        rows.push({
          商品编号: String(item.item_id),
          编号: String(model.product_info?.model_id ?? ''),
          系统竞价价格: toAmount(b.bid_price),
          最终价格: toAmount(b.estimated_supply_price),
          我的最佳价格: toAmount(b.floor_price),
          我的活动价格: toAmount(b.ceiling_price),
        });
      }
    }
    if (!d.has_more) break;
    pageNum += 1;
    if (pageNum > MAX_PAGES) throw new Error('翻页超过 200 页，疑似死循环，已停止');
  }
  return { rows, total };
}

module.exports = { fetchWinningData };
