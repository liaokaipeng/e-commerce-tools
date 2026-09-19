'use strict';
// 刷新编排与并发控制：per-shop 锁 + 全局串行链 + 冷却 + TTL 复用 + 失效标记。
// **红线**：刷新一律经 ensureFresh / refreshShopNow，绝不逐店遍历手写刷新；按 shop_id 刷新得到的
// token 只绑定该店（merchant_id 刷出来的是商户级 token，调店铺级接口报 invalid_acceess_token），
// 所以刷新结果只写回本店、失效也只标本店。
const { nowSec } = require('../../lib/openapi-utils');
const { ACCESS_EXPIRE_MARGIN, REFRESH_COOLDOWN_MS } = require('../constants');
const { refreshToken } = require('./refresh');
const { saveRefreshResult } = require('./persist');
const { isAuthFatalAfterRefresh } = require('./errors');

// per-shop 刷新锁：并发调用同一店铺接口时只触发一次刷新
const refreshLocks = new Map(); // shopId -> Promise
// 全局刷新串行链：跨店铺刷新统一排队，避免并发刷新同一批凭证时的踩踏
let refreshChain = Promise.resolve();

/**
 * 执行一次按店刷新（无锁，由调用方保证串行），返回 { accessToken, accessExpireAt, synced, mode }。
 * 手动刷新与自动续期是同一条路：都按店铺 shop_id 刷新、只写回本店。
 */
async function performRefresh(env, shopId) {
  const store = require('../store');
  // 串行轮到本店时重读最新凭证（可能已被标记失效）
  const latest = store.getShop(env, shopId);
  if (!latest) throw new Error(`店铺 ${shopId} 尚未授权，请先在「开放平台」页面完成店铺授权`);
  if (latest.invalid) {
    throw new Error(`店铺 ${shopId} 授权已失效：${latest.invalidReason || '凭证无效'}（到「开放平台」页重新授权后自动恢复采集）`);
  }
  const fresh = await refreshToken(env, shopId, latest.refreshToken);
  return {
    accessToken: fresh.accessToken,
    accessExpireAt: nowSec() + fresh.expireIn,
    synced: saveRefreshResult(env, shopId, fresh),
    mode: 'individual',
  };
}

/**
 * 取可用 access_token：未过期直接复用（force=true 跳过该判断，强制走刷新）。
 * 同一店铺的并发刷新共享同一个 Promise；跨店铺刷新统一排进全局串行链。
 * 刷新失败且确认凭证死透时把**该店铺**标记「需重新授权」。
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
        // 凭证死透：只标记本店（按 shop_id 刷新，token 不跨店共享）
        if (isAuthFatalAfterRefresh(e.message)) store.markShopInvalid(env, shopId, e.message);
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
 * 与自动续期走完全相同的按店刷新路径，只写回本店 token。
 * 额外开启冷却（cooldown）：刚刷过且 token 仍有效时直接复用，防连点把刚轮换的凭证刷死
 * （返回 mode='cooldown'，synced=0）。认证失败重试走的是 ensureFresh(force) 而非本函数，不受冷却影响。
 * @returns {Promise<{accessToken: string, accessExpireAt: number, synced: number, mode: string}>}
 */
function refreshShopNow(env, shopId) {
  return ensureFresh(env, shopId, { force: true, cooldown: true });
}

module.exports = { REFRESH_COOLDOWN_MS, performRefresh, ensureFresh, refreshShopNow };
