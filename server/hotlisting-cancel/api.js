'use strict';
// Shopee 取消注册 Hot Listing 接口调用层（URL 拼接与请求层见 lib/shopee-session.js）。
const {
  HOST, DEFAULT_REGION, apiPost, buildShopeeUrl, fetchShopRegion,
} = require('../lib/shopee-session');
const { RSKU_STATUS_ENROLLED, PAGE_LIMIT, MAX_PAGES } = require('./constants');
const { extractEnrolledSkus } = require('./parse');

/** 获取店铺市场（cbsc_shop_region），取不到时按 DEFAULT_REGION 继续（buybox 接口必须带该参数） */
async function regionOf(cookie, shopId) {
  return (await fetchShopRegion(cookie.header, shopId)) || DEFAULT_REGION;
}

/**
 * 拉取一个 SPU 的全部「已注册」SKU（offset/limit 翻页取全）。
 * @returns {Array} extractEnrolledSkus 的行
 */
async function fetchEnrolledSkus(cookie, shopId, region, spuId) {
  const url = buildShopeeUrl('/api/mkt/buybox/get_rsku_vsku_list', { shopId, region, spcCds: cookie.spcCds });
  const referer = `${HOST}/portal/marketing/cmt-buy-box?spuId=${spuId}&trackerSource=1&cnsc_shop_id=${shopId}`;
  const rows = [];
  let offset = 0;
  for (let page = 1; page <= MAX_PAGES; page++) {
    const j = await apiPost(url, cookie.header, {
      from_condition: { spu_id: Number(spuId) },
      search_filter: { rsku_status: RSKU_STATUS_ENROLLED, item_name: '' },
      page_info: { offset, limit: PAGE_LIMIT },
    }, { referer, label: `获取 SPU ${spuId} 已注册列表` });
    const d = j.data || {};
    rows.push(...extractEnrolledSkus(d));
    const pageInfo = d.page_info || {};
    const total = Number(pageInfo.total_count || 0);
    offset += PAGE_LIMIT;
    if (offset >= total || (d.vrsku_info_list || []).length === 0) break;
  }
  return rows;
}

/** 取消注册一条 SKU（update_enroll，seller_decision 置 0） */
async function unenrollSku(cookie, shopId, region, rskuId, vskuId) {
  const url = buildShopeeUrl('/api/mkt/buybox/update_enroll', { shopId, region, spcCds: cookie.spcCds });
  return apiPost(url, cookie.header, {
    rsku_id: Number(rskuId),
    vsku_id: Number(vskuId),
    seller_decision: 0,
  }, { label: `取消注册 SKU ${rskuId}` });
}

module.exports = { regionOf, fetchEnrolledSkus, unenrollSku };
