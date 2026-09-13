'use strict';
// 商品域库存解析（纯函数）。
const { LOW_STOCK_LINE } = require('../constants');

/** 型号库存（stock_info_v2.summary_info.total_available_stock / stock 字段兜底），无则 null */
function stockOfModel(model) {
  if (!model || typeof model !== 'object') return null;
  const si = model.stock_info_v2 || model.stock_info;
  if (si && typeof si === 'object') {
    const sum = si.summary_info;
    if (sum && typeof sum === 'object') {
      for (const k of ['total_available_stock', 'available_stock', 'stock']) {
        const v = sum[k];
        if (typeof v === 'number' && isFinite(v)) return v;
      }
    }
    for (const k of ['total_available_stock', 'available_stock', 'stock']) {
      const v = si[k];
      if (typeof v === 'number' && isFinite(v)) return v;
    }
  }
  if (typeof model.stock === 'number' && isFinite(model.stock)) return model.stock;
  return null;
}

/** 库存汇总（纯函数）：断货（=0）与低库存（1..安全线）SKU 数（型号粒度） */
function stockSummary(items, lowLine) {
  const line = typeof lowLine === 'number' ? lowLine : LOW_STOCK_LINE;
  let out = 0;
  let low = 0;
  for (const it of items || []) {
    const s = stockOfModel(it);
    if (s == null) continue;
    if (s <= 0) out += 1;
    else if (s <= line) low += 1;
  }
  return { out_of_stock: out, low_stock: low };
}

/** 商品库存合计（纯函数）：全部型号库存求和，无任何库存数据返回 null */
function itemStockTotal(models) {
  let total = null;
  for (const m of models || []) {
    const s = stockOfModel(m);
    if (s == null) continue;
    total = (total || 0) + s;
  }
  return total;
}

/**
 * 商品粒度库存状态（纯函数）：一个商品的库存 = 其全部型号库存之和，
 * 全 0 视为断货（避免停产变体把「断货SKU数」撑爆），≤ 安全线视为低库存。
 * @param {array} models 该商品的型号数组
 * @returns {'out'|'low'|'ok'|null} null=无可用库存数据
 */
function itemStockState(models, lowLine) {
  const total = itemStockTotal(models);
  if (total == null) return null;
  const line = typeof lowLine === 'number' ? lowLine : LOW_STOCK_LINE;
  if (total <= 0) return 'out';
  if (total <= line) return 'low';
  return 'ok';
}

module.exports = { stockOfModel, stockSummary, itemStockTotal, itemStockState };
