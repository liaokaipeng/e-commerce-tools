'use strict';
// --all 自动翻页：复用 server/openapi/client 的 callOpenApi（自动签名 / 附带 token / 过期刷新）。
// 官方查询接口有三种翻页语义，按首屏响应键自适应：
//   next_cursor（订单 / 评价）· next_offset（商品列表）· more + page_no（资金 / 售后）
// 不做翻页的接口（响应无 more）直接返回首屏；循环受 maxPages 硬上限约束。
const { callOpenApi } = require('../../server/openapi/client');

const DEFAULT_MAX_PAGES = 10;

/** 取响应载荷层（response 优先，其次顶层），用于识别翻页键与列表键 */
function responseOf(raw) {
  if (raw && typeof raw === 'object' && raw.response && typeof raw.response === 'object') return raw.response;
  return raw && typeof raw === 'object' ? raw : {};
}

/** 载荷层中第一个数组值字段，作为跨页拼接的列表键 */
function firstArrayKey(resp) {
  for (const k of Object.keys(resp || {})) {
    if (Array.isArray(resp[k])) return k;
  }
  return null;
}

/**
 * 调用开放平台接口；all 为真时自动翻页合并结果。
 * @param {object} p { apiPath, business, shopId, method, all, maxPages }
 * @returns {Promise<object>} 网关响应结构（自动翻页时 response 内为合并后的列表 + pages）
 */
async function callWithPaging({ apiPath, business, shopId, method, all, maxPages }) {
  const base = Object.assign({}, business || {});
  const first = await callOpenApi(apiPath, base, { shopId, method });
  if (!all) return first;

  const cap = Number.isFinite(maxPages) && maxPages > 0 ? maxPages : DEFAULT_MAX_PAGES;
  let cur = responseOf(first);
  const key = firstArrayKey(cur);
  if (!key || !cur.more) return first; // 无列表键或无翻页语义：不翻页

  const style = cur.next_cursor !== undefined ? 'cursor'
    : cur.next_offset !== undefined ? 'offset'
    : 'page';
  const startPage = base.page_no != null ? Number(base.page_no) : 1;
  let collected = Array.isArray(cur[key]) ? cur[key].slice() : [];
  let pages = 1;

  while (pages < cap) {
    let params;
    if (style === 'cursor') {
      const c = String(cur.next_cursor || '');
      if (!c) break;
      params = Object.assign({}, base, { cursor: c });
    } else if (style === 'offset') {
      params = Object.assign({}, base, { offset: cur.next_offset });
    } else {
      params = Object.assign({}, base, { page_no: startPage + pages });
    }
    const j = await callOpenApi(apiPath, params, { shopId, method });
    pages++;
    cur = responseOf(j);
    if (Array.isArray(cur[key])) collected = collected.concat(cur[key]);
    if (!cur.more) break;
  }

  const merged = Object.assign({}, responseOf(first));
  merged[key] = collected;
  merged.pages = pages;
  if (first && typeof first === 'object' && first.response && typeof first.response === 'object') {
    return Object.assign({}, first, { response: merged });
  }
  return Object.assign({}, first, merged);
}

module.exports = { callWithPaging, DEFAULT_MAX_PAGES };
