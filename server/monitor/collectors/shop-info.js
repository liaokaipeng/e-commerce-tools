'use strict';
// 店铺基础信息查询：拉店铺名与地区（region 用于币种识别）。
// 解析口径与 openapi/stores-view.js 共用（openapi/client/parse.js 的 parseShopInfoPayload）。
const { callOpenApi, parseShopInfoPayload } = require('../../openapi/client');

/** 拉取店铺信息（get_shop_info GET）：返回 { name, region }，失败返回 null（region 用于币种识别） */
async function fetchShopInfo(shopId) {
  try {
    const j = await callOpenApi('/api/v2/shop/get_shop_info', {}, { shopId, method: 'GET' });
    return parseShopInfoPayload(j);
  } catch (e) {
    return null;
  }
}

module.exports = { fetchShopInfo };
