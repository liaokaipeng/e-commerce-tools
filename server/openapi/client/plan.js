'use strict';
// 刷新计划（纯函数）：决定某店铺 token 到期后如何续期。
// 手动刷新与自动续期共用同一决策，避免「共享 token 组被单店刷新拖死全组」。

/**
 * @param {object} shop 目标店铺 { shopId, refreshToken, merchantId }
 * @param {array} allShops 同环境全部店铺
 * @returns {{mode: 'individual'|'group-merchant'|'group-nomerchant', merchantId?: string, groupSize?: number}}
 * - individual：独立凭证（各店各自授权/刷新得来），按店铺正常刷新；
 * - group-merchant：主账号共享 token（多店同一 refresh_token）且同属一个 merchant，
 *   用 merchant_id 整组刷新（官方 FAQ138 Q8：主账号下共享 token 对可用 merchant_id 或 shop_id 刷新），
 *   成功后新 token 对传播给全组，避免「首店刷新拖死全组」；
 * - group-nomerchant：共享 token 但无 merchant_id，无法整组续期（单店刷新会绑定该店并拖死全组），
 *   只能重新授权。
 */
function planRefresh(shop, allShops) {
  const list = Array.isArray(allShops) ? allShops : [];
  const group = list.filter((s) => s.refreshToken && s.refreshToken === shop.refreshToken);
  if (group.length > 1) {
    const merchants = [...new Set(group.map((s) => s.merchantId).filter(Boolean))];
    if (merchants.length === 1) return { mode: 'group-merchant', merchantId: merchants[0], groupSize: group.length };
    return { mode: 'group-nomerchant', groupSize: group.length };
  }
  return { mode: 'individual' };
}

module.exports = { planRefresh };
