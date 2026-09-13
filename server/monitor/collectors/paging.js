'use strict';
// 通用翻页收集：不同接口的翻页语义（cursor / page_no）收敛在此，供各域采集器复用。
const { callOpenApi } = require('../../openapi/client');
const { MAX_PAGES, PAGE_SIZE } = require('./constants');
const { totalOf } = require('./parse/common');

/**
 * cursor 翻页收集列表（more + next_cursor 语义，订单/首公里/评论通用）。
 * @param {function} [opts.stopWhen] 收到某页列表后判断是否提前结束（如已翻过统计窗口）
 * @param {number} [opts.maxPages] 本接口翻页上限（默认 MAX_PAGES）
 */
async function collectByCursor(shopId, path, params, listKey, opts) {
  const out = [];
  const cap = (opts && opts.maxPages) || MAX_PAGES;
  const stopWhen = opts && opts.stopWhen;
  let cursor = '';
  for (let page = 0; page < cap; page++) {
    const j = await callOpenApi(path, Object.assign({}, params, { cursor }), { shopId, method: 'GET' });
    const resp = (j && j.response) || {};
    const list = Array.isArray(resp[listKey]) ? resp[listKey] : [];
    out.push(...list);
    if (stopWhen && stopWhen(list)) break;
    if (!resp.more) break;
    cursor = String(resp.next_cursor || '');
    if (!cursor) break;
  }
  return out;
}

/**
 * page_no 翻页收集列表（more + 满页判断，资金/售后通用）。
 * @param {number} [startPage] 起始页：1=页码语义（payout/escrow），0=offset 语义（wallet/returns）
 * @returns {Promise<{ items: Array, total: number|null }>} total 取首页响应总数（无则 null）
 */
async function collectByPageDetailed(shopId, path, params, listKey, startPage) {
  const items = [];
  let total = null;
  const start = startPage == null ? 1 : startPage;
  for (let i = 0; i < MAX_PAGES; i++) {
    const j = await callOpenApi(path, Object.assign({}, params, { page_no: start + i }), { shopId, method: 'GET' });
    const resp = (j && j.response) || {};
    if (i === 0) total = totalOf(j);
    const list = Array.isArray(resp[listKey]) ? resp[listKey] : [];
    items.push(...list);
    if (!resp.more || list.length < PAGE_SIZE) break;
  }
  return { items, total };
}

/** page_no 翻页收集列表（仅返回条目数组） */
async function collectByPage(shopId, path, params, listKey, startPage) {
  return (await collectByPageDetailed(shopId, path, params, listKey, startPage)).items;
}

module.exports = { collectByCursor, collectByPage, collectByPageDetailed };
