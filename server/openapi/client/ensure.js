'use strict';
// 刷新编排与并发控制：per-shop 锁 + 全局串行链 + 冷却 + TTL 复用 + 失效标记，统一走 planRefresh 的分组决策。
// **红线**：刷新一律经 ensureFresh / refreshShopNow，绝不逐店遍历刷新；单店刷新共享 token 组会作废
// 组内其它店铺的 refresh_token。本模块只做编排，不改刷新语义。
const { nowSec } = require('../../lib/openapi-utils');
const { ACCESS_EXPIRE_MARGIN, REFRESH_COOLDOWN_MS } = require('../constants');
const { planRefresh } = require('./plan');
const { refreshToken, refreshTokenWithMerchant } = require('./refresh');
const { saveRefreshResult, saveRefreshResultGroup, markGroupInvalid, markInvalidByPlan } = require('./persist');
const { isAuthDead } = require('./errors');

// per-shop 刷新锁：并发调用同一店铺接口时只触发一次刷新
const refreshLocks = new Map(); // shopId -> Promise
// 全局刷新串行链：主账号下各店铺共享同一 refresh_token（刷新即轮换），
// 跨店铺并发刷新会互相踩踏（后发者拿到已失效的旧 token），统一串行执行
let refreshChain = Promise.resolve();

/**
 * 执行一次刷新（无锁，由调用方保证串行），返回 { accessToken, accessExpireAt, synced, mode }。
 * 分组决策统一走 planRefresh —— **手动刷新与自动续期必须是同一条路**：
 * 共享 token 组若被单店刷新，旧 refresh_token 立即作废且新 token 只绑定该店，
 * 其余店铺随后会用已作废的旧 token 去整组续期，导致整组被判「需重新授权」。
 */
async function performRefresh(env, shopId) {
  const store = require('../store');
  // 串行轮到本店时重读最新凭证（可能已被其它店铺的刷新轮换/标记失效）
  const latest = store.getShop(env, shopId);
  if (!latest) throw new Error(`店铺 ${shopId} 尚未授权，请先在「开放平台」页面完成店铺授权`);
  if (latest.invalid) {
    throw new Error(`店铺 ${shopId} 授权已失效：${latest.invalidReason || '凭证无效'}（到「开放平台」页重新授权后自动恢复采集）`);
  }
  const oldRefresh = latest.refreshToken;
  const plan = planRefresh(latest, store.getShopsRaw(env));
  if (plan.mode === 'group-merchant') {
    // 共享 token 整组续期：merchant_id 刷新 + 全组传播（单店刷新会绑定该店并拖死其余店铺）
    const fresh = await refreshTokenWithMerchant(env, plan.merchantId, oldRefresh);
    return {
      accessToken: fresh.accessToken,
      accessExpireAt: nowSec() + fresh.expireIn,
      synced: saveRefreshResultGroup(env, oldRefresh, fresh),
      mode: plan.mode,
    };
  }
  if (plan.mode === 'group-nomerchant') {
    // 共享 token 无法整组续期（无 merchant_id 或组内跨多个商户）：整组标记需重新授权，避免每店轮番失败刷网关
    markGroupInvalid(env, oldRefresh, '主账号共享 token 已到期且无法整组续期，请到「开放平台」页重新主账号授权一次即可全部恢复');
    throw new Error('主账号共享 token 已到期且无 merchant_id 可整组续期，请到「开放平台」页重新授权');
  }
  const fresh = await refreshToken(env, shopId, oldRefresh);
  return {
    accessToken: fresh.accessToken,
    accessExpireAt: nowSec() + fresh.expireIn,
    synced: saveRefreshResult(env, shopId, fresh),
    mode: plan.mode,
  };
}

/**
 * 取可用 access_token：未过期直接复用（force=true 跳过该判断，强制走刷新）。
 * 同一店铺的并发刷新共享同一个 Promise；跨店铺刷新统一排进全局串行链（共享 token 轮换防踩踏）。
 * 刷新失败且确认凭证死透时按分组语义标记「需重新授权」。
 * @param {string} env 环境
 * @param {string|number} shopId 店铺 ID
 * @param {object} [opts] { force, cooldown }
 *   force=true 时即使未过期也强制刷新（手动刷新 / 认证失败重试）；
 *   cooldown=true 时（仅手动/批量刷新入口）若距上次成功刷新不足 REFRESH_COOLDOWN_MS 且当前 token 仍有效，
 *   直接复用当前 token 返回 mode='cooldown'，不发网关请求——防连点把刚轮换的凭证刷死。
 *   认证失败重试**不能**开 cooldown，否则复用的还是坏 token（见 callOpenApi）。
 * @returns {Promise<{accessToken: string, accessExpireAt: number, synced: number, mode: string}>}
 */
function ensureFresh(env, shopId, opts = {}) {
  const store = require('../store');
  const force = !!opts.force;
  const cooldown = !!opts.cooldown;
  const shop = store.getShop(env, shopId);
  if (!shop) throw new Error(`店铺 ${shopId} 尚未授权，请先在「开放平台」页面完成店铺授权`);
  if (shop.invalid) {
    throw new Error(`店铺 ${shopId} 授权已失效：${shop.invalidReason || '凭证无效'}（到「开放平台」页重新授权后自动恢复采集）`);
  }
  const remain = (shop.accessExpireAt || 0) - nowSec() - ACCESS_EXPIRE_MARGIN;
  // 冷却：手动/批量刷新入口专用。当前 token 仍有效且刚刷过 → 复用，避免连续刷新把凭证刷死
  if (force && cooldown && remain > 0 && shop.refreshedAt && Date.now() - shop.refreshedAt < REFRESH_COOLDOWN_MS) {
    return Promise.resolve({
      accessToken: shop.accessToken,
      accessExpireAt: shop.accessExpireAt || 0,
      synced: 0,
      mode: 'cooldown',
    });
  }
  if (!force && remain > 0) {
    return Promise.resolve({
      accessToken: shop.accessToken,
      accessExpireAt: shop.accessExpireAt || 0,
      synced: 0,
      mode: 'cached',
    });
  }
  // 需要刷新（同一店铺的并发刷新共享同一个 Promise，跨店铺走全局串行链）
  const key = String(shopId);
  let p = refreshLocks.get(key);
  if (!p) {
    p = refreshChain
      .then(() => performRefresh(env, shopId))
      .catch((e) => {
        // 凭证死透：按分组语义标记（共享 token 整组标记，独立凭证只标本店）
        if (isAuthDead(e.message)) markInvalidByPlan(env, shopId, e.message);
        throw e;
      })
      .finally(() => { refreshLocks.delete(key); });
    refreshLocks.set(key, p);
    // 单个刷新失败不能卡死后续排队（错误由本次调用方消化）
    refreshChain = p.catch(() => {});
  }
  return p;
}

/**
 * 强制刷新某店铺（「开放平台」页的「刷新」按钮 / 批量刷新）。
 * 与自动续期走完全相同的分组决策与串行链：共享 token 组会整组续期，
 * 避免「手动刷新单店 → 同组其它店铺的 refresh_token 被作废」。
 * 额外开启冷却（cooldown）：刚刷过且 token 仍有效时直接复用，防连点把刚轮换的凭证刷死
 * （返回 mode='cooldown'，synced=0）。认证失败重试走的是 ensureFresh(force) 而非本函数，不受冷却影响。
 * @returns {Promise<{accessToken: string, accessExpireAt: number, synced: number, mode: string}>}
 */
function refreshShopNow(env, shopId) {
  return ensureFresh(env, shopId, { force: true, cooldown: true });
}

module.exports = { REFRESH_COOLDOWN_MS, performRefresh, ensureFresh, refreshShopNow };
