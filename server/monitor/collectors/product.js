'use strict';
// 商品域采集：在售商品库存（商品粒度：全型号合计）与问题商品数。
// 接口形态（生产环境实测 2026-08）：
//   product.get_item_list      必填 item_status + update_time_from/to + offset/page_size，
//                              返回 response.item（仅 item_id/状态，无库存），next_offset 翻页
//   product.get_model_list     item_id → response.model[].stock_info_v2.summary_info.total_available_stock
//   account_health.get_listings_with_issues  返回 response.listing_list + total_count
const { callOpenApi } = require('../../openapi/client');
const { collectByPageDetailed } = require('./paging');
const { collectItemIds } = require('./catalog');
const {
  detail, listOf, itemStockState, itemStockTotal, violationBreakdown,
} = require('./parse');
const {
  PAGE_SIZE, ITEMS_PER_SCAN, LOW_STOCK_LINE, VIOLATION_REASON_NAMES,
} = require('./constants');

async function collectProductDomain(shopId) {
  const metrics = {};
  const errors = [];
  const details = {};
  // 1) 商品清单（item_status 必填 + 更新时间窗），收集 item_id；失败则不产出库存指标
  let ids = [];
  let listOk = false;
  try {
    ids = await collectItemIds(shopId);
    listOk = true;
  } catch (e) {
    errors.push('商品清单：' + e.message);
  }
  // 2) 抽查前 ITEMS_PER_SCAN 个商品的库存（商品粒度：全型号合计），列表拉取失败不产出库存指标
  if (listOk) {
    try {
      let out = 0;
      let low = 0;
      const outRows = [];
      const lowRows = [];
      for (const id of ids.slice(0, ITEMS_PER_SCAN)) {
        try {
          const j = await callOpenApi('/api/v2/product/get_model_list', { item_id: Number(id) }, { shopId, method: 'GET' });
          const models = listOf(j, ['model', 'models']);
          const st = itemStockState(models);
          if (st === 'out') {
            out += 1;
            outRows.push({ id, title: id, sub: `库存合计 0（断货）` });
          } else if (st === 'low') {
            low += 1;
            lowRows.push({ id, title: id, sub: `库存合计 ${itemStockTotal(models)}（≤ 安全线 ${LOW_STOCK_LINE} 件）` });
          }
        } catch (e) {
          // 单品失败（如套装/下架中）跳过，不影响整域
        }
      }
      metrics['product.out_of_stock'] = out;
      metrics['product.low_stock'] = low;
      details['product.out_of_stock'] = detail('', outRows);
      details['product.low_stock'] = detail('', lowRows);
    } catch (e) {
      errors.push('库存：' + e.message);
    }
  }
  // 3) 问题商品数（账户健康模块的问题 listing 清单；翻页统一走 paging.collectByPageDetailed，总数取响应 total_count）
  try {
    const { items, total } = await collectByPageDetailed(shopId, '/api/v2/account_health/get_listings_with_issues', {
      page_size: PAGE_SIZE,
    }, 'listing_list', 1);
    metrics['product.violations'] = total != null ? total : items.length;
    const breakdown = violationBreakdown(items);
    if (breakdown || items.length) {
      details['product.violations'] = detail('明细 ' + breakdown, items.map((it) => ({
        id: String(it && it.item_id != null ? it.item_id : ''),
        title: String(it && it.item_id != null ? it.item_id : '未知商品'),
        sub: VIOLATION_REASON_NAMES[it && it.reason] || (it && it.reason != null ? '其他(' + it.reason + ')' : '未知原因'),
      })));
    }
  } catch (e) {
    errors.push('问题商品：' + e.message);
  }
  if (Object.keys(metrics).length === 0) throw new Error(errors.join('；') || '商品域无可用数据');
  return { domain: 'product', metrics, details, errors };
}

module.exports = { collectProductDomain };
