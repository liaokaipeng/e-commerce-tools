'use strict';
// 取消竞价的纯解析函数（便于单测）。
const { toAmount } = require('../lib/shopee-session');

/**
 * 从 get_item_ongoing_list 的响应 data 中提取「待改进」竞价行（纯函数，便于单测）。
 * @param {object} data 接口响应的 data（含 list / has_more）
 * @returns {Array<{itemId, itemName, modelId, modelName, bidId, price, suggestedPrice}>}
 */
function extractImprovementItems(data) {
  const rows = [];
  for (const item of (data && data.list) || []) {
    for (const model of item.model_list || []) {
      const b = model.bidding_info || {};
      if (!b.bid_id) continue; // 无竞价编号的不可撤销
      rows.push({
        itemId: String(item.item_id),
        itemName: String(item.item_name || ''),
        modelId: String(model.product_info?.model_id ?? ''),
        modelName: String(model.product_info?.model_name ?? ''),
        bidId: String(b.bid_id),
        price: toAmount(b.bid_price),
        suggestedPrice: toAmount(b.default_suggest_price),
      });
    }
  }
  return rows;
}

module.exports = { extractImprovementItems };
