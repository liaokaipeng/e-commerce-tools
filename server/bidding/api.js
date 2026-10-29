'use strict';
// 竞价数据抓取（纯 HTTP，请求层见 lib/shopee-session.js）。
const { toAmount, collectBiddingList } = require('../lib/shopee-session');
const { WINNING_TAB } = require('./constants');

/** 拉取【获胜】竞价数据（page_tab=3），翻页取全部，返回归一化行与总数 */
async function fetchWinningData(cookieHeader, shopId, region) {
  return collectBiddingList(cookieHeader, {
    shopId,
    region,
    pageTab: WINNING_TAB,
    label: '获取获胜竞价列表',
    mapRows: (d) => d.list.flatMap((item) => item.model_list.map((model) => {
      const b = model.bidding_info || {};
      return {
        商品编号: String(item.item_id),
        编号: String(model.product_info?.model_id ?? ''),
        系统竞价价格: toAmount(b.bid_price),
        最终价格: toAmount(b.estimated_supply_price),
        我的最佳价格: toAmount(b.floor_price),
        我的活动价格: toAmount(b.ceiling_price),
      };
    })),
  });
}

module.exports = { fetchWinningData };
