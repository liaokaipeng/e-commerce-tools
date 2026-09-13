'use strict';
/**
 * Shopee 卖家中心共享会话与请求工具（门面）
 *
 * 竞价导出（bidding）/ 取消竞价（bidding-cancel）/ 取消注册 Hot Listing（hotlisting-cancel）
 * 三个模块共用同一份登录 Cookie（server/data/bidding-session.json，由浏览器扩展推送保存）。
 *
 * 本文件曾是「会话 / 卖家中心请求 / 店铺名聚合 / 金额换算 / 延时」多职责的杂物模块，
 * 现按单一职责拆分到 lib/shopee/（constants / session / client / stores / amount）与 lib/sleep.js，
 * 本文件保留为门面，re-export 全部原有导出，调用方与测试的 require 路径不变。
 */
const { SESSION_FILE, UA, HOST, DEFAULT_REGION } = require('./shopee/constants');
const {
  readSession, matchCookies, loadCookieHeader, loadCookie, assertLoginOk,
} = require('./shopee/session');
const {
  buildShopeeUrl, apiGet, apiPost, fetchShopRegion,
} = require('./shopee/client');
const { loadStoreNames, storeNameOf } = require('./shopee/stores');
const { toAmount } = require('./shopee/amount');
const { sleep } = require('./sleep');

module.exports = {
  SESSION_FILE,
  UA,
  HOST,
  DEFAULT_REGION,
  readSession,
  matchCookies,
  loadCookieHeader,
  loadCookie,
  assertLoginOk,
  buildShopeeUrl,
  apiGet,
  apiPost,
  fetchShopRegion,
  loadStoreNames,
  storeNameOf,
  toAmount,
  sleep,
};
