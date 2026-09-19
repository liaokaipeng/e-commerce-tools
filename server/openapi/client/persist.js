'use strict';
// 刷新结果持久化写回：把新 token 写回凭证库，**只写回发起刷新的那个店铺**。
// 不能跨店传播：官方按 shop_id 刷新得到的 token 绑定该店，merchant_id 刷出来的是商户级 token
// （实测调店铺级接口报 invalid_acceess_token），传播给其他店只会让它们全部不可用。
const { nowSec } = require('../../lib/openapi-utils');

/**
 * 把刷新结果写回凭证库（先拿到新 token 再写盘），只写回本店。
 * @returns 更新的店铺数（恒为 1）
 */
function saveRefreshResult(env, shopId, fresh) {
  const store = require('../store');
  store.setShop(env, shopId, {
    accessToken: fresh.accessToken,
    refreshToken: fresh.refreshToken,
    accessExpireAt: nowSec() + fresh.expireIn,
    refreshedAt: Date.now(), // 手动刷新冷却基准（见 REFRESH_COOLDOWN_MS）
    invalid: false,
  });
  return 1;
}

module.exports = { saveRefreshResult };
