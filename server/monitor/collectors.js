'use strict';
// 采集器：按域调用开放平台接口（查询类接口统一 GET，经 client.callOpenApi 自动签名/刷新），
// 返回归一化指标 { domain, metrics: { metricId: number|null } }。
// 接口形态均为生产环境实测（2026-08）：
//   order.get_order_list       必填 order_status + time_range_field + time_from/to + page_size，
//                              返回 response.order_list（仅 order_sn/booking_sn，无时间字段），cursor 翻页；
//                              订单年龄按 order_sn 的 YYMMDD 前缀估算（无精确时间，见 orderAgeBuckets）
//   first_mile.get_unbind_order_list  返回 response.order_list + more/next_cursor
//   product.get_item_list      必填 item_status + update_time_from/to + offset/page_size，
//                              返回 response.item（仅 item_id/状态，无库存），next_offset 翻页
//   product.get_model_list     item_id → response.model[].stock_info_v2.summary_info.total_available_stock
//   account_health.get_shop_performance  response.metric_list（metric_name → current_period）+ overall_performance
//   account_health.get_penalty_point_history / get_listings_with_issues  response.total_count
// 单个子调用独立容错，全部子调用失败才抛错（调度器记入采集失败并触发系统告警）。
const { callOpenApi } = require('../openapi/client');

const PAGE_SIZE = 100;
const MAX_PAGES = 10; // 单接口翻页上限
const ORDER_WINDOW_DAYS = 14; // 订单查询时间窗（官方要求 ≤15 天）
const ITEM_SCAN_WINDOW_DAYS = 30; // 商品列表更新时间窗
const ITEMS_PER_SCAN = 50; // 每轮抽查库存的商品数（控制 67 店的调用量，按更新时间倒序抽查）
const LOW_STOCK_LINE = 5; // 低库存判定线（件）

/** 取响应里的通用列表（response/response.data/顶层多字段兜底） */
function listOf(json, keys) {
  if (!json || typeof json !== 'object') return [];
  const resp = json.response && typeof json.response === 'object' ? json.response : null;
  const data = json.data && typeof json.data === 'object' ? json.data : json;
  const pools = [resp, data, json];
  for (const pool of pools) {
    if (!pool || typeof pool !== 'object') continue;
    for (const k of keys) {
      if (Array.isArray(pool[k])) return pool[k];
    }
  }
  return [];
}

/** 取响应总数（total_count / total / count / more 等），无则 null */
function totalOf(json) {
  if (!json || typeof json !== 'object') return null;
  const resp = json.response && typeof json.response === 'object' ? json.response : json;
  for (const k of ['total_count', 'total', 'count']) {
    const v = resp[k];
    if (typeof v === 'number' && isFinite(v)) return v;
    if (typeof v === 'string' && v !== '' && isFinite(Number(v))) return Number(v);
  }
  return null;
}

/** order_sn 前缀 YYMMDD → 本地 0 点 Date（订单号如 260816G8NXB128 含创建日期） */
function orderSnDate(sn) {
  const m = /^(\d{2})(\d{2})(\d{2})/.exec(String(sn || ''));
  if (!m) return null;
  return new Date(2000 + Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/**
 * 待发货订单按单号日期分桶（纯函数）：
 * get_order_list 列表项不含创建时间，仅 order_sn 携带 YYMMDD 日期，故按「天」粒度估算：
 *   pending_12_24h = 今天创建的待发货订单（0-24 小时）
 *   pending_24h    = 昨天及更早创建的待发货订单（有超 24h 风险）
 */
function orderAgeBuckets(orders, nowMs) {
  const today0 = new Date(nowMs || Date.now());
  today0.setHours(0, 0, 0, 0);
  let pToday = 0;
  let pOld = 0;
  for (const o of orders || []) {
    const d = orderSnDate(o && o.order_sn);
    if (!d) continue;
    if (d.getTime() >= today0.getTime()) pToday += 1;
    else pOld += 1;
  }
  return { pending_12_24h: pToday, pending_24h: pOld };
}

/** cursor 翻页收集订单列表（order_sn 列表） */
async function collectOrdersByStatus(shopId, orderStatus) {
  const nowSec = Math.floor(Date.now() / 1000);
  const orders = [];
  let cursor = '';
  for (let page = 0; page < MAX_PAGES; page++) {
    const j = await callOpenApi('/api/v2/order/get_order_list', {
      order_status: orderStatus,
      time_range_field: orderStatus === 'IN_CANCEL' ? 'update_time' : 'create_time',
      time_from: nowSec - ORDER_WINDOW_DAYS * 86400,
      time_to: nowSec,
      page_size: PAGE_SIZE,
      cursor,
    }, { shopId, method: 'GET' });
    const resp = (j && j.response) || {};
    orders.push(...(resp.order_list || []));
    if (!resp.more) break;
    cursor = String(resp.next_cursor || '');
    if (!cursor) break;
  }
  return orders;
}

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

/**
 * 商品粒度库存状态（纯函数）：一个商品的库存 = 其全部型号库存之和，
 * 全 0 视为断货（避免停产变体把「断货SKU数」撑爆），≤ 安全线视为低库存。
 * @param {array} models 该商品的型号数组
 * @returns {'out'|'low'|'ok'|null} null=无可用库存数据
 */
function itemStockState(models, lowLine) {
  const line = typeof lowLine === 'number' ? lowLine : LOW_STOCK_LINE;
  let total = null;
  for (const m of models || []) {
    const s = stockOfModel(m);
    if (s == null) continue;
    total = (total || 0) + s;
  }
  if (total == null) return null;
  if (total <= 0) return 'out';
  if (total <= line) return 'low';
  return 'ok';
}

/** 账户健康归一化（纯函数）：metric_list 按 metric_name 取值，缺失记 null */
function normalizeHealth(json) {
  const out = { late_shipment_rate: null, non_fulfilment_rate: null, rating: null, penalty_points: null };
  const resp = json && json.response && typeof json.response === 'object' ? json.response : null;
  const ml = resp && Array.isArray(resp.metric_list) ? resp.metric_list : [];
  const num = (names) => {
    for (const name of names) {
      const m = ml.find((x) => x && x.metric_name === name);
      if (!m || m.current_period === null || m.current_period === undefined || m.current_period === '') continue;
      const n = Number(m.current_period);
      if (isFinite(n)) return n;
    }
    return null;
  };
  out.late_shipment_rate = num(['late_shipment_rate']);
  out.non_fulfilment_rate = num(['non_fulfillment_rate', 'non_fulfilment_rate']);
  out.rating = num(['shop_rating', 'rating']);
  const op = resp && resp.overall_performance;
  if (out.rating === null && op && op.rating !== undefined && op.rating !== '') {
    const n = Number(op.rating);
    if (isFinite(n)) out.rating = n;
  }
  return out;
}

/** 拉取店铺名（get_shop_info GET），失败返回 null */
async function fetchShopName(shopId) {
  try {
    const j = await callOpenApi('/api/v2/shop/get_shop_info', {}, { shopId, method: 'GET' });
    const name = (j && (j.shop_name || (j.data && j.data.shop_name))) || '';
    return String(name) || null;
  } catch (e) {
    return null;
  }
}

/** 采集一个域：返回 { domain, metrics }；子调用独立容错，全失败才抛错 */
async function collectDomain(shopId, domain) {
  if (domain === 'order') return collectOrderDomain(shopId);
  if (domain === 'product') return collectProductDomain(shopId);
  if (domain === 'health') return collectHealthDomain(shopId);
  throw new Error('未知采集域：' + domain);
}

async function collectOrderDomain(shopId) {
  const metrics = {};
  const errors = [];
  const now = Date.now();
  try {
    const orders = await collectOrdersByStatus(shopId, 'READY_TO_SHIP');
    const buckets = orderAgeBuckets(orders, now);
    metrics['order.pending_12_24h'] = buckets.pending_12_24h;
    metrics['order.pending_24h'] = buckets.pending_24h;
  } catch (e) {
    errors.push('待发货订单：' + e.message);
  }
  try {
    const cancels = await collectOrdersByStatus(shopId, 'IN_CANCEL');
    metrics['order.cancel_pending'] = cancels.length;
  } catch (e) {
    errors.push('取消申请：' + e.message);
  }
  try {
    const orders = [];
    let cursor = '';
    for (let page = 0; page < MAX_PAGES; page++) {
      const j = await callOpenApi('/api/v2/first_mile/get_unbind_order_list', {
        page_size: PAGE_SIZE,
        cursor,
      }, { shopId, method: 'GET' });
      const resp = (j && j.response) || {};
      orders.push(...(resp.order_list || []));
      if (!resp.more) break;
      cursor = String(resp.next_cursor || '');
      if (!cursor) break;
    }
    metrics['firstmile.unbound'] = orders.length;
  } catch (e) {
    errors.push('首公里：' + e.message);
  }
  if (Object.keys(metrics).length === 0) throw new Error(errors.join('；') || '订单域无可用数据');
  return { domain: 'order', metrics, errors };
}

async function collectProductDomain(shopId) {
  const metrics = {};
  const errors = [];
  const nowSec = Math.floor(Date.now() / 1000);
  // 1) 商品清单（item_status 必填 + 更新时间窗），收集 item_id；失败则不产出库存指标
  const ids = [];
  let listOk = false;
  try {
    let offset = 0;
    let hasNext = true;
    for (let page = 0; page < MAX_PAGES && hasNext; page++) {
      const j = await callOpenApi('/api/v2/product/get_item_list', {
        item_status: 'NORMAL',
        update_time_from: nowSec - ITEM_SCAN_WINDOW_DAYS * 86400,
        update_time_to: nowSec,
        offset,
        page_size: PAGE_SIZE,
      }, { shopId, method: 'GET' });
      const resp = (j && j.response) || {};
      const items = resp.item || [];
      for (const it of items) if (it && it.item_id) ids.push(String(it.item_id));
      hasNext = resp.has_next_page === true;
      offset = Number(resp.next_offset || 0);
      if (!hasNext) break;
    }
    listOk = true;
  } catch (e) {
    errors.push('商品清单：' + e.message);
  }
  // 2) 抽查前 ITEMS_PER_SCAN 个商品的库存（商品粒度：全型号合计），列表拉取失败不产出库存指标
  if (listOk) {
    try {
      let out = 0;
      let low = 0;
      for (const id of ids.slice(0, ITEMS_PER_SCAN)) {
        try {
          const j = await callOpenApi('/api/v2/product/get_model_list', { item_id: Number(id) }, { shopId, method: 'GET' });
          const models = listOf(j, ['model', 'models']);
          const st = itemStockState(models);
          if (st === 'out') out += 1;
          else if (st === 'low') low += 1;
        } catch (e) {
          // 单品失败（如套装/下架中）跳过，不影响整域
        }
      }
      metrics['product.out_of_stock'] = out;
      metrics['product.low_stock'] = low;
    } catch (e) {
      errors.push('库存：' + e.message);
    }
  }
  // 3) 问题商品数（账户健康模块的问题 listing 清单）
  try {
    const j = await callOpenApi('/api/v2/account_health/get_listings_with_issues', {}, { shopId, method: 'GET' });
    const total = totalOf(j);
    metrics['product.violations'] = total != null ? total : listOf(j, ['listing_list']).length;
  } catch (e) {
    errors.push('问题商品：' + e.message);
  }
  if (Object.keys(metrics).length === 0) throw new Error(errors.join('；') || '商品域无可用数据');
  return { domain: 'product', metrics, errors };
}

async function collectHealthDomain(shopId) {
  const metrics = {};
  const errors = [];
  try {
    const j = await callOpenApi('/api/v2/account_health/get_shop_performance', {}, { shopId, method: 'GET' });
    const h = normalizeHealth(j);
    metrics['health.late_shipment_rate'] = h.late_shipment_rate;
    metrics['health.non_fulfilment_rate'] = h.non_fulfilment_rate;
    metrics['health.rating'] = h.rating;
    if (Object.values(h).every((v) => v == null)) throw new Error('账户健康返回缺少可用指标');
  } catch (e) {
    errors.push('健康指标：' + e.message);
  }
  try {
    const j = await callOpenApi('/api/v2/account_health/get_penalty_point_history', {}, { shopId, method: 'GET' });
    const total = totalOf(j);
    metrics['health.penalty_points'] = total != null ? total : 0;
  } catch (e) {
    errors.push('扣分记录：' + e.message);
  }
  if (Object.keys(metrics).length === 0) throw new Error(errors.join('；') || '健康域无可用数据');
  return { domain: 'health', metrics, errors };
}

module.exports = {
  PAGE_SIZE,
  LOW_STOCK_LINE,
  collectDomain,
  fetchShopName,
  // 纯函数（单测覆盖）
  listOf,
  totalOf,
  orderSnDate,
  orderAgeBuckets,
  stockOfModel,
  stockSummary,
  itemStockState,
  normalizeHealth,
};
