'use strict';
// 店铺基础信息查询：拉店铺名与地区（region 用于币种识别）。
const { callOpenApi } = require('../../openapi/client');

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

module.exports = { fetchShopInfo };
