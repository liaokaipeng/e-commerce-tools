'use strict';
// 商品清单查询：拉取在售商品 ID（商品域与降级差评扫描共用）。
const { callOpenApi } = require('../../openapi/client');
const { MAX_PAGES, PAGE_SIZE, ITEM_SCAN_WINDOW_DAYS } = require('./constants');

/** 拉取在售商品 ID 清单（更新时间窗内，offset/has_next_page 翻页；商品域与降级差评扫描共用） */
async function collectItemIds(shopId) {
  const nowSec = Math.floor(Date.now() / 1000);
  const ids = [];
  let offset = 0;
  for (let page = 0; page < MAX_PAGES; page++) {
    const j = await callOpenApi('/api/v2/product/get_item_list', {
      item_status: 'NORMAL',
      update_time_from: nowSec - ITEM_SCAN_WINDOW_DAYS * 86400,
      update_time_to: nowSec,
      offset,
      page_size: PAGE_SIZE,
    }, { shopId, method: 'GET' });
    const resp = (j && j.response) || {};
    for (const it of resp.item || []) if (it && it.item_id) ids.push(String(it.item_id));
    if (resp.has_next_page !== true) break;
    offset = Number(resp.next_offset || 0);
  }
  return ids;
}

module.exports = { collectItemIds };
