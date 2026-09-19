'use strict';
// 批量刷新计划（纯函数）：官方 refresh_access_token 要求 shop_id / merchant_id「必须分别刷新」，
// 且按 shop_id 刷新得到的 token 只绑定该店（实测 merchant_id 刷出来的是商户级 token，调店铺级接口报
// invalid_acceess_token），故这里**一店一个单元**，不再按 refresh_token 归组去重。
// 刷不了的店铺（缺 refresh_token / 已标失效）直接跳过并给出原因，不发网关请求、不额外标失效。
/**
 * @param {Array<{shopId, refreshToken, merchantId, invalid}>} shops 同环境全部店铺凭证
 * @returns {{groups: Array<{repShopId, shopIds, size, mode}>, skipped: Array<{shopIds, size, reason}>}}
 *   每个 group 恰为一个店铺（size=1、mode='individual'），groups 保序便于展示与测试。
 */
function planRefreshGroups(shops) {
  const list = Array.isArray(shops) ? shops.slice() : [];
  const byId = (a, b) => String(a).localeCompare(String(b), undefined, { numeric: true });
  const groups = [];
  const skipped = [];
  for (const s of list) {
    if (!s || s.shopId === undefined || s.shopId === null) continue;
    const shopId = String(s.shopId);
    if (!s.refreshToken) {
      skipped.push({ shopIds: [shopId], size: 1, reason: '缺少 refresh_token，需重新授权' });
      continue;
    }
    if (s.invalid) {
      skipped.push({ shopIds: [shopId], size: 1, reason: '授权已失效，需重新授权' });
      continue;
    }
    groups.push({ repShopId: shopId, shopIds: [shopId], size: 1, mode: 'individual' });
  }

  // 输出顺序稳定（便于展示与测试）：按店铺 ID 数字序排序
  groups.sort((a, b) => byId(a.repShopId, b.repShopId));
  skipped.sort((a, b) => byId(a.shopIds[0], b.shopIds[0]));
  return { groups, skipped };
}

module.exports = { planRefreshGroups };
