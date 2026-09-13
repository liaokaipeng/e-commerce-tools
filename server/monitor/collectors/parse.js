'use strict';
// 采集响应归一化纯函数：把各域接口返回值转成统一指标数值 / 告警明细行。
// 全部为无副作用纯函数（便于单测），不发起任何请求；接口字段的多键兜底见各函数注释。
const {
  SNIPPET_MAX,
  LOW_STOCK_LINE,
  AFTERSALE_WINDOW_MS,
  NEGATIVE_STAR_MAX,
  COMMENT_KEYWORDS,
  PUNISHMENT_TIER_NAMES,
  VIOLATION_REASON_NAMES,
  RETURN_REASON_NAMES,
} = require('./constants');

// ---------- 通用格式化 / 取值 ----------

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

// ---------- 通用响应解析 ----------

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

// ---------- 订单域 ----------

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

// ---------- 商品域：库存 ----------

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

// ---------- 账户健康域 ----------

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

// ---------- 资金域 ----------

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

// ---------- 售后评价域 ----------

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

// ---------- 错误分类 ----------

/** 是否为「权限不足/未开通」类错误（区别于网络/参数/凭证错误，命中则该域跳过且不触发系统自检告警） */
function isPermissionDenied(message) {
  return /permission|no permission|not authorized|not permitted|forbidden|无权|未开通|无权限/i.test(String(message || ''));
}

/** 全部子调用均因权限不足失败 → 该店该域不支持（调度器跳过且不触发系统自检告警） */
function allPermissionDenied(errors) {
  return Array.isArray(errors) && errors.length > 0 && errors.every((e) => isPermissionDenied(String(e || '')));
}

module.exports = {
  snippet,
  detail,
  fmtSec,
  snDateText,
  firstOf,
  round2,
  listOf,
  totalOf,
  orderSnDate,
  orderAgeBuckets,
  stockOfModel,
  stockSummary,
  itemStockTotal,
  itemStockState,
  normalizeHealth,
  formatDdMmYyyy,
  normalizeAdsHourly,
  normalizeBalance,
  normalizePunishments,
  violationBreakdown,
  walletSummary,
  returnSummary,
  negativeCommentItems,
  commentSummary,
  isPermissionDenied,
  allPermissionDenied,
};
