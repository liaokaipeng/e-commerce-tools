'use strict';
// 刷新结果持久化写回：把新 token 按分组语义写回凭证库，并在确认凭证死透时按分组标记「需重新授权」。
const { nowSec } = require('../../lib/openapi-utils');
const { planRefresh } = require('./plan');

/**
 * 把刷新结果写回凭证库（先拿到新 token 再写盘）。
 * 实测语义（2026-08 生产环境）：主账号授权得到的 token 为账号级通用，但
 * access_token/get 返回的新 token 对**绑定到发起刷新的那个 shop_id**——
 * 其它店铺拿它调接口会报 Invalid access_token，拿它刷新会报 refresh token 或 shop_id 错误。
 * 因此独立凭证的刷新结果只写回发起刷新的店铺，不跨店传播；其余店铺失效时需重新授权
 * （大屏/开放平台页会给出对应提示）。共享 token 组由 planRefresh 决策走整组续期，
 * 不走本函数（见 performRefresh / saveRefreshResultGroup）。
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

/**
 * 整组写回：把 merchant_id 刷新结果传播给「仍持有同一旧 refresh_token」的全部店铺，
 * 并清除各店失效标记（组内店铺共享主账号 token，刷新成功后全组恢复）。
 * @returns 更新的店铺数
 */
function saveRefreshResultGroup(env, oldRefreshToken, fresh) {
  const store = require('../store');
  const group = store.getShopsRaw(env).filter((s) => s.refreshToken === oldRefreshToken);
  for (const s of group) {
    store.setShop(env, s.shopId, {
      accessToken: fresh.accessToken,
      refreshToken: fresh.refreshToken,
      accessExpireAt: nowSec() + fresh.expireIn,
      refreshedAt: Date.now(),
      invalid: false,
    });
  }
  return group.length;
}

/** 组内失效标记：把「仍持有同一旧 refresh_token」的店铺全部标记为需重新授权（共享 token 无法续期时） */
function markGroupInvalid(env, oldRefreshToken, reason) {
  const store = require('../store');
  const group = store.getShopsRaw(env).filter((s) => s.refreshToken === oldRefreshToken);
  for (const s of group) store.markShopInvalid(env, s.shopId, reason);
  return group.length;
}

/**
 * 确认凭证死透后按分组语义标记：独立凭证只标记本店，共享 token 组整组标记。
 * 手动刷新、自动续期、通用接口调用的失败路径统一走这里，避免「同一件事两套标记口径」。
 */
function markInvalidByPlan(env, shopId, reason) {
  const store = require('../store');
  const latest = store.getShop(env, shopId);
  if (!latest) return 0;
  const plan = planRefresh(latest, store.getShopsRaw(env));
  if (plan.mode === 'individual') {
    store.markShopInvalid(env, shopId, reason);
    return 1;
  }
  return markGroupInvalid(env, latest.refreshToken, '主账号共享 token 已失效且无法续期，请到「开放平台」页重新主账号授权一次即可全部恢复');
}

module.exports = { saveRefreshResult, saveRefreshResultGroup, markGroupInvalid, markInvalidByPlan };
