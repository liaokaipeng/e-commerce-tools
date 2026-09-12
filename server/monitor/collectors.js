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
const FUNDS_WINDOW_DAYS = 15; // 资金域查询时间窗（打款明细/钱包流水官方 ≤15 天）
const AFTERSALE_WINDOW_MS = 24 * 3600 * 1000; // 售后评价域统计窗口（近 24h）
const COMMENT_SCAN_ITEMS = 20; // 差评扫描降级模式：逐商品抽查的商品数上限
const NEGATIVE_STAR_MAX = 3; // 差评判定：1~3 星
// 差评关键词（告警明细用；命中仅作展示，不影响差评计数口径）
const COMMENT_KEYWORDS = ['假货', '假的', '质量差', '很烂', '垃圾', '不满意', '太慢', '破损', '坏了'];

// ---------- 告警结构化明细（rows：[{ id, title, sub }]，行数上限由引擎统一截断） ----------
const SNIPPET_MAX = 60;

/** 截断长文本（明细行展示用） */
function snippet(s, n) {
  const max = n || SNIPPET_MAX;
  const t = String(s == null ? '' : s).trim();
  return t.length > max ? t.slice(0, max) + '…' : t;
}

/** 组装明细对象：text 拼进告警消息（可为空），rows 进大屏告警详情抽屉 */
function detail(text, rows) {
  return { text: text || '', rows: Array.isArray(rows) ? rows : [] };
}

/** Unix 秒 → 'YYYY-MM-DD HH:mm'（无效值返回空串） */
function fmtSec(ts) {
  const n = Number(ts);
  if (!isFinite(n) || n <= 0) return '';
  const d = new Date(n * 1000);
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** order_sn 的 YYMMDD → 'YYYY-MM-DD'（解析失败返回空串） */
function snDateText(sn) {
  const d = orderSnDate(sn);
  if (!d) return '';
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** 提取对象里第一个非空字段值（接口字段未实测时多键兜底） */
function firstOf(obj, keys) {
  for (const k of keys) {
    const v = obj ? obj[k] : undefined;
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return null;
}

const round2 = (n) => Math.round(n * 100) / 100;

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

// ---------- Roadmap 新增域解析纯函数（官方文档形态，2026-08 调研；未生产实测） ----------

/** 广告接口日期格式 DD-MM-YYYY（官方要求，与订单/商品模块的 Unix 秒不同） */
function formatDdMmYyyy(date) {
  const d = date || new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getDate())}-${p(d.getMonth() + 1)}-${d.getFullYear()}`;
}

/**
 * 广告小时级表现归一化（纯函数）：response 为单日小时数组（官方无分页、单日一次返回），
 * 聚合 花费=Σexpense、成交额=Σdirect_gmv、点击=Σclicks；
 * ROAS=成交额/花费（花费为 0 时 null）、CPC=花费/点击（点击为 0 时 null，官方无独立 CPC 字段）。
 */
function normalizeAdsHourly(list) {
  let spend = 0;
  let revenue = 0;
  let clicks = 0;
  let has = false;
  for (const it of list || []) {
    if (!it || typeof it !== 'object') continue;
    const e = Number(it.expense);
    const g = Number(it.direct_gmv);
    const c = Number(it.clicks);
    if (isFinite(e)) { spend += e; has = true; }
    if (isFinite(g)) revenue += g;
    if (isFinite(c)) clicks += c;
  }
  if (!has) return { spend: null, roas: null, cpc: null };
  return {
    spend: round2(spend),
    roas: spend > 0 && revenue > 0 ? round2(revenue / spend) : null,
    cpc: clicks > 0 ? round2(spend / clicks) : null,
  };
}

/** 广告余额（response.total_balance，含付费+赠金），无则 null */
function normalizeBalance(json) {
  const resp = json && json.response && typeof json.response === 'object' ? json.response : null;
  if (!resp) return null;
  const v = resp.total_balance;
  if (typeof v === 'number' && isFinite(v)) return v;
  if (typeof v === 'string' && v !== '' && isFinite(Number(v))) return Number(v);
  return null;
}

const PUNISHMENT_TIER_NAMES = { 1: 'Tier1', 2: 'Tier2', 3: 'Tier3', 4: 'Tier4', 5: 'Tier5' };

/**
 * 处罚记录归一化（纯函数）：count = response.total_count（缺失回退 punishment_list 长度），
 * detail = 按 reason（1~5 即 Tier1~Tier5）聚合的级别分布。
 */
function normalizePunishments(json) {
  const resp = json && json.response && typeof json.response === 'object' ? json.response : null;
  const list = resp && Array.isArray(resp.punishment_list) ? resp.punishment_list : [];
  const total = resp && resp.total_count != null ? Number(resp.total_count) : NaN;
  const count = isFinite(total) ? total : list.length;
  const cnt = {};
  for (const p of list) {
    if (!p || typeof p !== 'object') continue;
    const name = PUNISHMENT_TIER_NAMES[p.reason] || (p.reason != null ? '类型' + p.reason : '未知');
    cnt[name] = (cnt[name] || 0) + 1;
  }
  const detail = Object.entries(cnt).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}×${v}`).join('/');
  return { count, detail };
}

// 问题商品原因枚举（get_listings_with_issues 的 listing_list[].reason，官方值 1~7）
const VIOLATION_REASON_NAMES = {
  1: '违禁商品', 2: '假冒商品', 3: '滥用', 4: '图片不当', 5: '信息不足', 6: '商城商品优化', 7: '其他商品优化',
};

/** 问题商品明细聚合（纯函数）：按 reason 中文分布 → 「违禁商品2/假冒商品1」 */
function violationBreakdown(list) {
  const cnt = {};
  for (const it of list || []) {
    if (!it || typeof it !== 'object' || it.reason == null) continue;
    const name = VIOLATION_REASON_NAMES[it.reason] || '其他(' + it.reason + ')';
    cnt[name] = (cnt[name] || 0) + 1;
  }
  return Object.entries(cnt).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}${v}`).join('/');
}

/**
 * 钱包流水汇总（纯函数）：pending = status∈{PENDING,INITIAL} 记录数（处理中/冻结信号）、
 * failed = status=FAILED 记录数；balance = 最新一条（create_time 最大）流水的 current_balance。
 * 时间窗由调用侧 create_time_from/to（≤15 天）控制，本函数不再过滤。
 */
function walletSummary(txns) {
  let pending = 0;
  let failed = 0;
  let balance = null;
  let balanceAt = -1;
  for (const t of txns || []) {
    if (!t || typeof t !== 'object') continue;
    const st = String(t.status || '').toUpperCase();
    if (st === 'PENDING' || st === 'INITIAL') pending += 1;
    else if (st === 'FAILED') failed += 1;
    if (typeof t.current_balance === 'number' && isFinite(t.current_balance)) {
      const at = typeof t.create_time === 'number' ? t.create_time : 0;
      if (at >= balanceAt) { balance = t.current_balance; balanceAt = at; }
    }
  }
  return { pending, failed, balance };
}

// 退货原因枚举中文映射（get_return_list 的 return[].reason，官方 31 个值）
const RETURN_REASON_NAMES = {
  NONRECEIPT: '未收到货', WRONG_ITEM: '发错商品', ITEM_DAMAGED: '商品损坏', DIFF_DESC: '与描述不符',
  MUITAL_AGREE: '协商一致', OTHER: '其他', USED: '已使用', NO_REASON: '无理由', ITEM_WRONGDAMAGED: '错发/损坏',
  CHANGE_MIND: '改变主意', ITEM_MISSING: '少件', EXPECTATION_FAILED: '未达预期', ITEM_FAKE: '疑似假货',
  PHYSICAL_DMG: '外观损坏', FUNCTIONAL_DMG: '功能故障', ITEM_NOT_FIT: '不合适', SUSPICIOUS_PARCEL: '包裹可疑',
  EXPIRED_PRODUCT: '商品过期', WRONG_ORDER_INFO: '订单信息错误', WRONG_ADDRESS: '地址错误',
  CHANGE_OF_MIND: '改变主意', SELLER_SENT_WRONG_ITEM: '卖家发错', SPILLED_CONTENTS: '内容物洒漏',
  BROKEN_PRODUCTS: '商品破损', DAMAGED_PACKAGE: '包装破损', SCRATCHED: '划痕', DAMAGED_OTHERS: '其他损坏',
  SIZE_DEVIATION: '尺寸偏差', LOOK_DEVIATION: '外观偏差', DATE_DEVIATION: '日期偏差', DIFFERENT_DESCRIPTION: '与描述不符',
};

/**
 * 退货申请汇总（纯函数）：近 24h（create_time 秒）内条数 + 原因分布明细（top5）。
 */
function returnSummary(returns, nowMs) {
  const now = nowMs || Date.now();
  let count = 0;
  const byReason = {};
  for (const r of returns || []) {
    if (!r || typeof r !== 'object') continue;
    const ct = r.create_time != null ? Number(r.create_time) * 1000 : NaN;
    if (!isFinite(ct) || ct > now || now - ct > AFTERSALE_WINDOW_MS) continue;
    count += 1;
    const name = RETURN_REASON_NAMES[r.reason] || String(r.reason || '未知原因');
    byReason[name] = (byReason[name] || 0) + 1;
  }
  const detail = Object.entries(byReason).sort((a, b) => b[1] - a[1]).slice(0, 5)
    .map(([k, v]) => `${k}${v}`).join('/');
  return { count, detail };
}

/** 近 24h 内 1~3 星的原始评论（结构化明细行用，与 commentSummary 同口径） */
function negativeCommentItems(items, nowMs) {
  const now = nowMs || Date.now();
  const out = [];
  for (const c of items || []) {
    if (!c || typeof c !== 'object') continue;
    const ct = c.create_time != null ? Number(c.create_time) * 1000 : NaN;
    if (!isFinite(ct) || ct > now || now - ct > AFTERSALE_WINDOW_MS) continue;
    const star = Number(c.rating_star);
    if (!isFinite(star) || star > NEGATIVE_STAR_MAX) continue;
    out.push(c);
  }
  return out;
}

/**
 * 差评汇总（纯函数）：近 24h 内 1~3 星评价数 + 差评文本关键词命中分布（top5）。
 * 关键词仅用于告警明细展示，不影响差评计数口径（差评 = 星级判定）。
 */
function commentSummary(items, keywords, nowMs) {
  const kws = Array.isArray(keywords) && keywords.length ? keywords : COMMENT_KEYWORDS;
  const now = nowMs || Date.now();
  let count = 0;
  const hits = {};
  for (const c of items || []) {
    if (!c || typeof c !== 'object') continue;
    const ct = c.create_time != null ? Number(c.create_time) * 1000 : NaN;
    if (!isFinite(ct) || ct > now || now - ct > AFTERSALE_WINDOW_MS) continue;
    const star = Number(c.rating_star);
    if (!isFinite(star) || star > NEGATIVE_STAR_MAX) continue;
    count += 1;
    const text = String(c.comment || '');
    for (const kw of kws) {
      if (text.includes(kw)) hits[kw] = (hits[kw] || 0) + 1;
    }
  }
  const detail = Object.entries(hits).sort((a, b) => b[1] - a[1]).slice(0, 5)
    .map(([k, v]) => `「${k}」${v}`).join('/');
  return { count, detail };
}

/** 是否为「权限不足/未开通」类错误（区别于网络/参数/凭证错误，命中则该域跳过且不触发系统自检告警） */
function isPermissionDenied(message) {
  return /permission|no permission|not authorized|not permitted|forbidden|无权|未开通|无权限/i.test(String(message || ''));
}

/** 拉取店铺信息（get_shop_info GET）：返回 { name, region }，失败返回 null（region 用于币种识别） */
async function fetchShopInfo(shopId) {
  try {
    const j = await callOpenApi('/api/v2/shop/get_shop_info', {}, { shopId, method: 'GET' });
    const pools = [j, j && j.response, j && j.data];
    let name = '';
    let region = '';
    for (const p of pools) {
      if (!p || typeof p !== 'object') continue;
      if (!name && p.shop_name) name = String(p.shop_name);
      if (!region) {
        for (const k of ['region', 'country', 'shop_region', 'shop_country']) {
          if (p[k] !== undefined && p[k] !== null && p[k] !== '') { region = String(p[k]); break; }
        }
      }
    }
    return { name: name || null, region: region || '' };
  } catch (e) {
    return null;
  }
}

/** 采集一个域：返回 { domain, metrics, details?, errors }；子调用独立容错，全失败才抛错 */
async function collectDomain(shopId, domain) {
  if (domain === 'order') return collectOrderDomain(shopId);
  if (domain === 'product') return collectProductDomain(shopId);
  if (domain === 'health') return collectHealthDomain(shopId);
  if (domain === 'ads') return collectAdsDomain(shopId);
  if (domain === 'funds') return collectFundsDomain(shopId);
  if (domain === 'aftersale') return collectAftersaleDomain(shopId);
  throw new Error('未知采集域：' + domain);
}

async function collectOrderDomain(shopId) {
  const metrics = {};
  const details = {};
  const errors = [];
  const now = Date.now();
  try {
    const orders = await collectOrdersByStatus(shopId, 'READY_TO_SHIP');
    const today0 = new Date(now);
    today0.setHours(0, 0, 0, 0);
    const todaySns = [];
    const olderSns = [];
    for (const o of orders || []) {
      const sn = o && o.order_sn;
      const d = orderSnDate(sn);
      if (!d) continue;
      (d.getTime() >= today0.getTime() ? todaySns : olderSns).push(sn);
    }
    metrics['order.pending_12_24h'] = todaySns.length;
    metrics['order.pending_24h'] = olderSns.length;
    details['order.pending_12_24h'] = detail('', todaySns.map((sn) => ({
      id: sn, title: sn, sub: `${snDateText(sn) || '今日'} 创建·待发货`,
    })));
    details['order.pending_24h'] = detail('', olderSns.map((sn) => ({
      id: sn, title: sn, sub: `${snDateText(sn) || '更早'} 创建·待发货（超 24h 风险）`,
    })));
  } catch (e) {
    errors.push('待发货订单：' + e.message);
  }
  try {
    const cancels = await collectOrdersByStatus(shopId, 'IN_CANCEL');
    const sns = (cancels || []).map((o) => o && o.order_sn).filter(Boolean);
    metrics['order.cancel_pending'] = cancels.length;
    details['order.cancel_pending'] = detail('', sns.map((sn) => ({
      id: sn, title: sn, sub: '买家申请取消·待处理',
    })));
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
    details['firstmile.unbound'] = detail('', orders
      .map((o) => o && o.order_sn).filter(Boolean)
      .map((sn) => ({ id: sn, title: sn, sub: '首公里未交接·待打单发货' })));
  } catch (e) {
    errors.push('首公里：' + e.message);
  }
  if (Object.keys(metrics).length === 0) throw new Error(errors.join('；') || '订单域无可用数据');
  return { domain: 'order', metrics, details, errors };
}

async function collectProductDomain(shopId) {
  const metrics = {};
  const errors = [];
  const details = {};
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
  // 3) 问题商品数（账户健康模块的问题 listing 清单；翻页收集明细按 reason 聚合进告警消息）
  try {
    let total = null;
    const items = [];
    for (let page = 1; page <= MAX_PAGES; page++) {
      const j = await callOpenApi('/api/v2/account_health/get_listings_with_issues', {
        page_no: page,
        page_size: PAGE_SIZE,
      }, { shopId, method: 'GET' });
      const resp = (j && j.response) || {};
      if (total == null) total = totalOf(j);
      const list = Array.isArray(resp.listing_list) ? resp.listing_list : [];
      items.push(...list);
      if (total != null && items.length >= total) break;
      if (list.length < PAGE_SIZE) break;
    }
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

async function collectHealthDomain(shopId) {
  const metrics = {};
  const errors = [];
  const details = {};
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
    // 扣分明细兜底（接口返回列表字段未实测，多键防御式提取；取不到就没有明细行）
    const plist = listOf(j, ['penalty_point_list', 'penalty_points_list', 'history_list']);
    if (plist.length) {
      details['health.penalty_points'] = detail('', plist.map((x, i) => {
        const o = x || {};
        const id = firstOf(o, ['penalty_point_id', 'penalty_id', 'id']) || 'No.' + (i + 1);
        return { id: String(id), title: String(id), sub: snippet(firstOf(o, ['reason', 'description', 'title']) || '扣分记录') };
      }));
    }
  } catch (e) {
    errors.push('扣分记录：' + e.message);
  }
  // 处罚记录（punishment_status 必填：1=进行中 / 2=已结束），级别分布进告警明细
  try {
    const j = await callOpenApi('/api/v2/account_health/get_punishment_history', {
      punishment_status: 1,
      page_no: 1,
      page_size: PAGE_SIZE,
    }, { shopId, method: 'GET' });
    const p = normalizePunishments(j);
    metrics['health.punishments'] = p.count;
    const plist = (j && j.response && Array.isArray(j.response.punishment_list)) ? j.response.punishment_list : [];
    if (p.detail || plist.length) {
      details['health.punishments'] = detail('处罚级别 ' + p.detail, plist.map((x, i) => {
        const o = x || {};
        const id = firstOf(o, ['punishment_id', 'punishment_log_id', 'log_id', 'id']) || 'No.' + (i + 1);
        const tier = PUNISHMENT_TIER_NAMES[o.reason] || (o.reason != null ? '类型' + o.reason : '未知类型');
        return { id: String(id), title: String(id), sub: tier + (o.grant_time ? '·' + fmtSec(o.grant_time) : '') };
      }));
    }
  } catch (e) {
    errors.push('处罚记录：' + e.message);
  }
  if (Object.keys(metrics).length === 0) throw new Error(errors.join('；') || '健康域无可用数据');
  return { domain: 'health', metrics, details, errors };
}

// ---------- Roadmap 新增采集域（广告 / 资金 / 售后评价） ----------
// 接口形态按官方文档接入（2026-08 调研，未生产实测）：
//   ads.get_all_cpc_ads_hourly_performance  performance_date(DD-MM-YYYY 单日,必填)，response 为小时数组，无分页
//   ads.get_total_balance                   无业务参数，response.total_balance（含付费+赠金）
//   payment.get_payout_detail               payout_time_from/to(≤15天)+page_size+page_no(1起,均必填)，仅跨境，官方已标记过时
//   payment.get_escrow_list                 release_time_from/to+page_no(1起)，仅返回已释放记录（无状态字段），作打款金额兜底
//   payment.get_wallet_transaction_list     page_no(offset 0起,必填)+page_size+create_time_from/to(≤15天)，仅本土，
//                                           status=FAILED/COMPLETED/PENDING/INITIAL 为唯一带状态的资金接口
//   returns.get_return_list                 page_no(offset 0起,必填)+page_size+create_time_from/to(≤15天)，
//                                           response.return[]（字段名 reason/status，无前缀）
//   product.get_comment                     cursor(必填,空串起)+page_size(1~100)，item_id 可选；响应 item_comment_list+more+next_cursor

/** 全部子调用均因权限不足失败 → 该店该域不支持（调度器跳过且不触发系统自检告警） */
function allPermissionDenied(errors) {
  return Array.isArray(errors) && errors.length > 0 && errors.every((e) => isPermissionDenied(String(e || '')));
}

async function collectAdsDomain(shopId) {
  const metrics = {};
  const errors = [];
  let anyOk = false;
  try {
    const j = await callOpenApi('/api/v2/ads/get_all_cpc_ads_hourly_performance', {
      performance_date: formatDdMmYyyy(new Date()),
    }, { shopId, method: 'GET' });
    const agg = normalizeAdsHourly(listOf(j, ['response']));
    if (agg.spend != null) metrics['ads.spend_today'] = agg.spend;
    if (agg.roas != null) metrics['ads.roas_today'] = agg.roas;
    if (agg.cpc != null) metrics['ads.cpc_today'] = agg.cpc;
    anyOk = true;
  } catch (e) {
    errors.push('小时表现：' + e.message);
  }
  try {
    const j = await callOpenApi('/api/v2/ads/get_total_balance', {}, { shopId, method: 'GET' });
    const b = normalizeBalance(j);
    if (b != null) metrics['ads.balance'] = b;
    anyOk = true;
  } catch (e) {
    errors.push('广告余额：' + e.message);
  }
  if (!anyOk) {
    if (allPermissionDenied(errors)) return { domain: 'ads', metrics, errors, unsupported: true, reason: errors.join('；') };
    throw new Error(errors.join('；') || '广告域无可用数据');
  }
  return { domain: 'ads', metrics, errors };
}

async function collectFundsDomain(shopId) {
  const metrics = {};
  const errors = [];
  const details = {};
  const nowSec = Math.floor(Date.now() / 1000);
  let anyOk = false;
  // 1) 打款明细（仅跨境；金额合计 → 近15天打款金额）
  try {
    let total = 0;
    let got = false;
    const payoutRows = [];
    for (let page = 1; page <= MAX_PAGES; page++) {
      const j = await callOpenApi('/api/v2/payment/get_payout_detail', {
        payout_time_from: nowSec - FUNDS_WINDOW_DAYS * 86400,
        payout_time_to: nowSec,
        page_size: PAGE_SIZE,
        page_no: page,
      }, { shopId, method: 'GET' });
      const resp = (j && j.response) || {};
      const list = Array.isArray(resp.payout_list) ? resp.payout_list : [];
      for (const p of list) {
        const info = (p && p.payout_info) || {};
        const amt = Number(info.payout_amount);
        if (isFinite(amt)) {
          total += amt;
          got = true;
          payoutRows.push({
            id: String(firstOf(info, ['payout_id', 'payout_sn']) || ''),
            title: '金额 ' + round2(amt),
            sub: fmtSec(firstOf(info, ['payout_time', 'create_time'])),
          });
        }
      }
      if (!resp.more || list.length < PAGE_SIZE) break;
    }
    if (got) {
      metrics['funds.payout_15d'] = round2(total);
      details['funds.payout_15d'] = detail('', payoutRows);
    }
    anyOk = true;
  } catch (e) {
    errors.push('打款明细：' + e.message);
  }
  // 2) 担保释放列表（官方无状态字段、仅已释放记录；payout_detail 不可用时作打款金额兜底）
  try {
    let total = 0;
    let got = false;
    const escrowRows = [];
    for (let page = 1; page <= MAX_PAGES; page++) {
      const j = await callOpenApi('/api/v2/payment/get_escrow_list', {
        release_time_from: nowSec - FUNDS_WINDOW_DAYS * 86400,
        release_time_to: nowSec,
        page_size: PAGE_SIZE,
        page_no: page,
      }, { shopId, method: 'GET' });
      const resp = (j && j.response) || {};
      const list = Array.isArray(resp.escrow_list) ? resp.escrow_list : [];
      for (const it of list) {
        const amt = it ? Number(it.payout_amount) : NaN;
        if (isFinite(amt)) {
          total += amt;
          got = true;
          escrowRows.push({
            id: String(firstOf(it, ['escrow_id', 'order_sn']) || ''),
            title: '金额 ' + round2(amt),
            sub: fmtSec(firstOf(it, ['release_time', 'create_time'])),
          });
        }
      }
      if (!resp.more || list.length < PAGE_SIZE) break;
    }
    if (got && metrics['funds.payout_15d'] == null) {
      metrics['funds.payout_15d'] = round2(total);
      details['funds.payout_15d'] = detail('近15天已释放担保金额合计（官方担保列表无状态字段，仅已释放记录）', escrowRows);
    }
    anyOk = true;
  } catch (e) {
    errors.push('担保列表：' + e.message);
  }
  // 3) 钱包流水（仅本土；唯一带状态字段的资金接口：处理中/失败计数 + 最新余额）
  try {
    const txns = [];
    for (let offset = 0; offset < MAX_PAGES * PAGE_SIZE; offset += PAGE_SIZE) {
      const j = await callOpenApi('/api/v2/payment/get_wallet_transaction_list', {
        page_no: offset, // offset 语义（0 起），非页码
        page_size: PAGE_SIZE,
        create_time_from: nowSec - FUNDS_WINDOW_DAYS * 86400,
        create_time_to: nowSec,
      }, { shopId, method: 'GET' });
      const resp = (j && j.response) || {};
      const list = Array.isArray(resp.transaction_list) ? resp.transaction_list : [];
      txns.push(...list);
      if (!resp.more || list.length < PAGE_SIZE) break;
    }
    const s = walletSummary(txns);
    metrics['funds.pending_txn'] = s.pending;
    metrics['funds.failed_txn'] = s.failed;
    if (s.balance != null) metrics['funds.wallet_balance'] = s.balance;
    const pendingRows = [];
    const failedRows = [];
    for (const t of txns || []) {
      const st = String((t && t.status) || '').toUpperCase();
      if (st !== 'PENDING' && st !== 'INITIAL' && st !== 'FAILED') continue;
      const id = String(firstOf(t, ['transaction_id', 'wallet_transaction_id', 'reference_id']) || '');
      const row = {
        id,
        title: id || ('流水·' + st),
        sub: `${st}${t && t.amount != null ? '·金额 ' + t.amount : ''}${t && t.create_time ? '·' + fmtSec(t.create_time) : ''}`,
      };
      (st === 'FAILED' ? failedRows : pendingRows).push(row);
    }
    details['funds.pending_txn'] = detail('', pendingRows);
    details['funds.failed_txn'] = detail('', failedRows);
    anyOk = true;
  } catch (e) {
    errors.push('钱包流水：' + e.message);
  }
  if (!anyOk) {
    if (allPermissionDenied(errors)) return { domain: 'funds', metrics, errors, unsupported: true, reason: errors.join('；') };
    throw new Error(errors.join('；') || '资金域无可用数据');
  }
  return { domain: 'funds', metrics, details, errors };
}

/** 全店差评扫描（官方 get_comment 的 item_id 可选，不带则按游标返回全店评论；语义未实测，失败/为空则降级逐商品） */
async function scanCommentsShopWide(shopId, nowMs) {
  let cursor = '';
  const items = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const j = await callOpenApi('/api/v2/product/get_comment', {
      cursor,
      page_size: PAGE_SIZE,
    }, { shopId, method: 'GET' });
    const resp = (j && j.response) || {};
    const list = Array.isArray(resp.item_comment_list) ? resp.item_comment_list : [];
    items.push(...list);
    // 已翻到 24h 前的评论即可提前结束；官方单接口最多回 500 条（more 可能恒为 true）
    if (list.some((c) => c && c.create_time && Number(c.create_time) * 1000 < nowMs - AFTERSALE_WINDOW_MS)) break;
    if (!resp.more) break;
    cursor = String(resp.next_cursor || '');
    if (!cursor) break;
  }
  if (!items.length) throw new Error('全店评论为空（网关可能要求 item_id）');
  return commentSummary(items, COMMENT_KEYWORDS, nowMs);
}

/** 逐商品差评扫描（降级模式）：商品清单 top COMMENT_SCAN_ITEMS 个，每商品最多 3 页评论 */
async function scanCommentsByItems(shopId, nowMs) {
  const nowSec = Math.floor(nowMs / 1000);
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
    const items = resp.item || [];
    for (const it of items) if (it && it.item_id) ids.push(String(it.item_id));
    if (resp.has_next_page !== true) break;
    offset = Number(resp.next_offset || 0);
  }
  const all = [];
  for (const id of ids.slice(0, COMMENT_SCAN_ITEMS)) {
    try {
      let cursor = '';
      for (let page = 0; page < 3; page++) {
        const j = await callOpenApi('/api/v2/product/get_comment', {
          item_id: Number(id),
          cursor,
          page_size: PAGE_SIZE,
        }, { shopId, method: 'GET' });
        const resp = (j && j.response) || {};
        const list = Array.isArray(resp.item_comment_list) ? resp.item_comment_list : [];
        all.push(...list);
        if (list.some((c) => c && c.create_time && Number(c.create_time) * 1000 < nowMs - AFTERSALE_WINDOW_MS)) break;
        if (!resp.more) break;
        cursor = String(resp.next_cursor || '');
        if (!cursor) break;
      }
    } catch (e) {
      // 单品失败（已下架等）跳过，不影响整域
    }
  }
  return Object.assign(commentSummary(all, COMMENT_KEYWORDS, nowMs), { items: negativeCommentItems(all, nowMs) });
}

async function collectAftersaleDomain(shopId) {
  const metrics = {};
  const errors = [];
  const details = {};
  const nowMs = Date.now();
  const nowSec = Math.floor(nowMs / 1000);
  let anyOk = false;
  // 1) 退货申请（24h 窗；page_no 为 offset 0 起）
  try {
    const returns = [];
    for (let offset = 0; offset < MAX_PAGES * PAGE_SIZE; offset += PAGE_SIZE) {
      const j = await callOpenApi('/api/v2/returns/get_return_list', {
        page_no: offset,
        page_size: PAGE_SIZE,
        create_time_from: nowSec - Math.floor(AFTERSALE_WINDOW_MS / 1000),
        create_time_to: nowSec,
      }, { shopId, method: 'GET' });
      const resp = (j && j.response) || {};
      const list = Array.isArray(resp.return) ? resp.return : [];
      returns.push(...list);
      if (!resp.more || list.length < PAGE_SIZE) break;
    }
    const s = returnSummary(returns, nowMs);
    metrics['aftersale.returns_24h'] = s.count;
    const recent = returns.filter((r) => {
      const ct = r && r.create_time != null ? Number(r.create_time) * 1000 : NaN;
      return isFinite(ct) && ct <= nowMs && nowMs - ct <= AFTERSALE_WINDOW_MS;
    });
    if (s.detail || recent.length) {
      details['aftersale.returns_24h'] = detail('原因分布 ' + s.detail, recent.map((r) => {
        const o = r || {};
        const id = String(firstOf(o, ['return_id', 'return_sn', 'id']) || '');
        const reason = RETURN_REASON_NAMES[o.reason] || String(o.reason || '未知原因');
        return { id, title: id || '退货申请', sub: `${reason}${o.status ? '·' + String(o.status) : ''}·${fmtSec(o.create_time)}` };
      }));
    }
    anyOk = true;
  } catch (e) {
    errors.push('退货申请：' + e.message);
  }
  // 2) 差评扫描（全店游标模式优先，失败/为空降级逐商品抽查）
  const applyCommentResult = (s) => {
    metrics['aftersale.negative_24h'] = s.count;
    if (s.detail || (s.items && s.items.length)) {
      details['aftersale.negative_24h'] = detail('关键词命中 ' + s.detail, (s.items || []).map((c) => {
        const o = c || {};
        const id = String(firstOf(o, ['comment_id', 'id']) || '');
        return {
          id,
          title: `★${o.rating_star != null ? o.rating_star : '?'} ${snippet(o.comment, 40)}`,
          sub: `商品 ${o.item_id != null ? o.item_id : '?'}·${fmtSec(o.create_time)}`,
        };
      }));
    }
    anyOk = true;
  };
  try {
    applyCommentResult(await scanCommentsShopWide(shopId, nowMs));
  } catch (e) {
    try {
      applyCommentResult(await scanCommentsByItems(shopId, nowMs));
    } catch (e2) {
      errors.push('差评扫描：' + e2.message);
    }
  }
  if (!anyOk) {
    if (allPermissionDenied(errors)) return { domain: 'aftersale', metrics, errors, unsupported: true, reason: errors.join('；') };
    throw new Error(errors.join('；') || '售后评价域无可用数据');
  }
  return { domain: 'aftersale', metrics, details, errors };
}

module.exports = {
  PAGE_SIZE,
  LOW_STOCK_LINE,
  collectDomain,
  fetchShopInfo,
  // 纯函数（单测覆盖）
  listOf,
  totalOf,
  orderSnDate,
  orderAgeBuckets,
  stockOfModel,
  stockSummary,
  itemStockState,
  itemStockTotal,
  normalizeHealth,
  formatDdMmYyyy,
  normalizeAdsHourly,
  normalizeBalance,
  normalizePunishments,
  violationBreakdown,
  walletSummary,
  returnSummary,
  commentSummary,
  negativeCommentItems,
  isPermissionDenied,
};
