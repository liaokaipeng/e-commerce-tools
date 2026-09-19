'use strict';
// --all 自动翻页：复用 server/openapi/client 的 callOpenApi（自动签名 / 附带 token / 过期刷新）。
// 翻页键优先级：接口元数据（api_meta_v2.json 的 paging）> 首屏响应键自适应。
// 官方三种翻页语义：
//   next_cursor（订单 / 评价）· next_offset（商品列表）· more + page_no（资金 / 售后）
// 不翻页的接口（响应无 more / next_cursor / next_offset）直接返回首屏；循环受 maxPages 上限约束。
// 合并后清理首页残留的翻页字段，并给出 pages / maxPages / truncated，避免调用方把
// 「被上限截断的部分数据」误当成全量（这是 agent 场景最容易出错的地方）。
//
// 提速：page 风格（page_no 确定性递增）且首屏带 total_count 时，剩余页并行拉取
// （页号由服务端换算偏移，客户端无前后依赖）；cursor / offset 的游标来自上一页响应，
// 必须串行。并行度 PAGE_FETCH_CONCURRENCY 按店内同接口小并发，限流按店铺维度，安全。
const { callOpenApi } = require('../../server/openapi/client');

const DEFAULT_MAX_PAGES = 10;
const PAGE_FETCH_CONCURRENCY = 4;

/** 有界并发映射：保持结果顺序（按 items 下标回填） */
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let cursor = 0;
  const worker = async () => {
    while (cursor < items.length) {
      const i = cursor++;
      out[i] = await fn(items[i], i);
    }
  };
  const n = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: n }, worker));
  return out;
}

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

/** 翻页风格：元数据优先，其次按首屏响应键推断（'' 表示不翻页） */
function detectStyle(resp, meta) {
  const st = meta && meta.paging && meta.paging.style;
  if (st) return st;
  if (resp && resp.next_cursor !== undefined) return 'cursor';
  if (resp && resp.next_offset !== undefined) return 'offset';
  if (resp && (resp.more !== undefined || resp.page_no !== undefined || resp.total_count !== undefined)) return 'page';
  return '';
}

/** 列表键：元数据优先，其次首屏第一个数组字段 */
function detectListKey(resp, meta) {
  const keys = meta && meta.paging && Array.isArray(meta.paging.listKeys) ? meta.paging.listKeys : [];
  for (const k of keys) {
    if (resp && Array.isArray(resp[k])) return k;
  }
  return keys.length ? keys[0] : firstArrayKey(resp);
}

/**
 * 当前页是否还有下一页。
 * 优先看 more；无 more 时：cursor 看 next_cursor、offset 看 next_offset、
 * page 风格退回「本页条数 >= page_size」判断（pageSize 未知则保守停止）。
 */
function stillMore(resp, style, pageSize, lastLen) {
  if (!resp || typeof resp !== 'object') return false;
  if (resp.more !== undefined && resp.more !== null) return !!resp.more;
  if (style === 'cursor') return !!resp.next_cursor;
  if (style === 'offset') return resp.next_offset !== undefined && resp.next_offset !== null;
  if (style === 'page' && pageSize > 0) return lastLen >= pageSize;
  return false;
}

/** 组装下一页请求参数；返回 null 表示无法继续 */
function nextParams(base, cur, style, startPage, pages) {
  if (style === 'cursor') {
    const c = String(cur.next_cursor || '');
    if (!c) return null;
    return Object.assign({}, base, { cursor: c });
  }
  if (style === 'offset') {
    if (cur.next_offset === undefined || cur.next_offset === null) return null;
    return Object.assign({}, base, { offset: cur.next_offset });
  }
  return Object.assign({}, base, { page_no: startPage + pages });
}

/**
 * 调用开放平台接口；all 为真时自动翻页合并结果。
 * @param {object} p { apiPath, business, shopId, method, all, maxPages, meta }
 *   meta: 接口元数据（可空），用于确定翻页风格与列表键
 * @returns {Promise<object>} 网关响应结构（自动翻页时 response 内为合并后的列表 + pages/maxPages/truncated）
 */
async function callWithPaging({ apiPath, business, shopId, method, all, maxPages, meta }) {
  const base = Object.assign({}, business || {});
  const first = await callOpenApi(apiPath, base, { shopId, method });
  if (!all) return first;
  if (maxPages === 0) return first; // 显式 --max-pages 0：不翻页，只要首屏

  const cap = Number.isFinite(maxPages) && maxPages > 0 ? Math.floor(maxPages) : DEFAULT_MAX_PAGES;
  let cur = responseOf(first);
  const key = detectListKey(cur, meta);
  const style = detectStyle(cur, meta);
  if (!key || !style) return first; // 无列表键或无法判定翻页语义：不翻页

  const pageSize = Number(base.page_size) > 0 ? Number(base.page_size) : 0;
  const startPage = base.page_no != null ? Number(base.page_no) : 1;
  let collected = Array.isArray(cur[key]) ? cur[key].slice() : [];
  let lastLen = collected.length;
  let pages = 1;
  let truncated = false;

  // page 风格提速：首页 + total_count + page_size 可算出总页数、页号确定性递增，剩余页并行拉取。
  // 仅当从第 1 页起（startPage===1）才成立——用户显式传 page_no 时页码基线不同，退回串行更稳。
  const totalNum = cur && Number(cur.total_count);
  if (style === 'page' && pageSize > 0 && startPage === 1 && Number.isFinite(totalNum)) {
    const totalPages = Math.max(1, Math.ceil(totalNum / pageSize));
    const lastPage = Math.min(cap, totalPages);
    if (lastPage > 1) {
      const pageNums = [];
      for (let p = startPage + 1; p <= lastPage; p++) pageNums.push(p);
      const responses = await mapLimit(pageNums, PAGE_FETCH_CONCURRENCY,
        (p) => callOpenApi(apiPath, Object.assign({}, base, { page_no: p }), { shopId, method }));
      for (const j of responses) {
        cur = responseOf(j);
        if (Array.isArray(cur[key])) {
          lastLen = cur[key].length;
          collected = collected.concat(cur[key]);
        } else {
          lastLen = 0;
        }
        pages++;
      }
      // 因页数上限退出、且总页数还有富余 → 标记截断
      truncated = lastPage >= cap && totalPages > lastPage;
    }
  } else {
    while (pages < cap) {
      if (!stillMore(cur, style, pageSize, lastLen)) break;
      const params = nextParams(base, cur, style, startPage, pages);
      if (!params) break;
      const j = await callOpenApi(apiPath, params, { shopId, method });
      pages++;
      cur = responseOf(j);
      if (Array.isArray(cur[key])) {
        lastLen = cur[key].length;
        collected = collected.concat(cur[key]);
      } else {
        lastLen = 0;
      }
    }
    // 因页数上限退出、且当前页仍显示有更多 → 标记截断（调用方据此判断「不是全量」）
    if (pages >= cap && stillMore(cur, style, pageSize, lastLen)) truncated = true;
  }

  const merged = Object.assign({}, responseOf(first));
  merged[key] = collected;
  merged.pages = pages;
  merged.maxPages = cap;
  merged.truncated = truncated;
  if ('more' in merged) merged.more = truncated;
  if (style === 'cursor') merged.next_cursor = truncated ? (cur.next_cursor || '') : '';
  if (style === 'offset') merged.next_offset = truncated ? (cur.next_offset === undefined ? null : cur.next_offset) : null;

  if (first && typeof first === 'object' && first.response && typeof first.response === 'object') {
    return Object.assign({}, first, { response: merged });
  }
  return Object.assign({}, first, merged);
}

module.exports = { callWithPaging, DEFAULT_MAX_PAGES, detectStyle, detectListKey, stillMore };
