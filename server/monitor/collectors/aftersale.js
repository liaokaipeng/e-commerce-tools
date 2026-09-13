'use strict';
// 售后评价域采集：退货申请（近 24h）与差评扫描（全店游标优先，失败降级逐商品抽查）。
// 接口形态（官方文档 2026-08 调研，未生产实测）：
//   returns.get_return_list   page_no(offset 0起,必填)+page_size+create_time_from/to(≤15天)，
//                             response.return[]（字段名 reason/status，无前缀）
//   product.get_comment       cursor(必填,空串起)+page_size(1~100)，item_id 可选；
//                             响应 item_comment_list+more+next_cursor
const { collectByCursor, collectByPage } = require('./paging');
const { collectItemIds } = require('./catalog');
const {
  detail, firstOf, snippet, fmtSec, returnSummary, commentSummary, negativeCommentItems, allPermissionDenied,
} = require('./parse');
const {
  PAGE_SIZE, AFTERSALE_WINDOW_MS, COMMENT_SCAN_ITEMS, RETURN_REASON_NAMES,
} = require('./constants');

/** 全店差评扫描（官方 get_comment 的 item_id 可选，不带则按游标返回全店评论；语义未实测，失败/为空则降级逐商品） */
async function scanCommentsShopWide(shopId, nowMs) {
  // 已翻到 24h 前的评论即可提前结束；官方单接口最多回 500 条（more 可能恒为 true）
  const items = await collectByCursor(shopId, '/api/v2/product/get_comment', { page_size: PAGE_SIZE }, 'item_comment_list', {
    stopWhen: (list) => list.some((c) => c && c.create_time && Number(c.create_time) * 1000 < nowMs - AFTERSALE_WINDOW_MS),
  });
  if (!items.length) throw new Error('全店评论为空（网关可能要求 item_id）');
  return commentSummary(items, COMMENT_KEYWORDS, nowMs);
}

/** 逐商品差评扫描（降级模式）：商品清单 top COMMENT_SCAN_ITEMS 个，每商品最多 3 页评论 */
async function scanCommentsByItems(shopId, nowMs) {
  const ids = await collectItemIds(shopId);
  const stopWhen = (list) => list.some((c) => c && c.create_time && Number(c.create_time) * 1000 < nowMs - AFTERSALE_WINDOW_MS);
  const all = [];
  for (const id of ids.slice(0, COMMENT_SCAN_ITEMS)) {
    try {
      all.push(...await collectByCursor(shopId, '/api/v2/product/get_comment', {
        item_id: Number(id),
        page_size: PAGE_SIZE,
      }, 'item_comment_list', { maxPages: 3, stopWhen }));
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
    const returns = await collectByPage(shopId, '/api/v2/returns/get_return_list', {
      page_size: PAGE_SIZE,
      create_time_from: nowSec - Math.floor(AFTERSALE_WINDOW_MS / 1000),
      create_time_to: nowSec,
    }, 'return', 0);
    const s = returnSummary(returns, nowMs);
    metrics['aftersale.returns_24h'] = s.count;
    // 24h 窗口过滤复用 returnSummary 的结果（不再在本处重复实现窗口判断）
    const recent = s.items || [];
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

module.exports = { collectAftersaleDomain };
