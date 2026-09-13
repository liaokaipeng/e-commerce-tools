'use strict';
// 售后评价域解析（纯函数）：退货申请窗口过滤与原因分布、差评窗口过滤与关键词命中。
const {
  AFTERSALE_WINDOW_MS,
  NEGATIVE_STAR_MAX,
  COMMENT_KEYWORDS,
  RETURN_REASON_NAMES,
} = require('../constants');

/** 近 24h 内的退货申请原始记录（create_time 秒；与 returnSummary 同口径） */
function recentReturns(returns, nowMs) {
  const now = nowMs || Date.now();
  const out = [];
  for (const r of returns || []) {
    if (!r || typeof r !== 'object') continue;
    const ct = r.create_time != null ? Number(r.create_time) * 1000 : NaN;
    if (!isFinite(ct) || ct > now || now - ct > AFTERSALE_WINDOW_MS) continue;
    out.push(r);
  }
  return out;
}

/**
 * 退货申请汇总（纯函数）：近 24h（create_time 秒）内条数 + 原因分布明细（top5）。
 * items 为同口径过滤后的原始记录，供调用方组装结构化明细行。
 */
function returnSummary(returns, nowMs) {
  const list = recentReturns(returns, nowMs);
  const byReason = {};
  for (const r of list) {
    const name = RETURN_REASON_NAMES[r.reason] || String(r.reason || '未知原因');
    byReason[name] = (byReason[name] || 0) + 1;
  }
  const detail = Object.entries(byReason).sort((a, b) => b[1] - a[1]).slice(0, 5)
    .map(([k, v]) => `${k}${v}`).join('/');
  return { count: list.length, detail, items: list };
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

module.exports = { recentReturns, returnSummary, negativeCommentItems, commentSummary };
