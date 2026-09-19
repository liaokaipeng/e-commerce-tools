'use strict';
// 通用开放平台接口调用入口：先取可用 token（含自动续期），失败时按认证类错误强制刷新一次后重试。
// 后续功能模块统一经此调用官方接口，无需自行拼签名 / 处理刷新。
const { signedCall } = require('./transport');
const { ensureFresh } = require('./ensure');
const { resolveApp } = require('./auth');
const { isAuthDead, isAuthRetryable, isAuthFatalAfterRefresh } = require('./errors');

/**
 * 通用开放平台接口调用（后续功能统一入口）。
 * 自动读取 App 配置、附带 access_token / shop_id 并签名；
 * access_token 过期先自动刷新；autoRefresh=false 时不重试认证类错误。
 * 确认凭证死透（刷新后仍报认证错）时把**该店铺**标记为「需重新授权」——只标本店，
 * 因为按 shop_id 刷新得到的 token 不跨店共享（见 docs/开放平台链路.md §3）。
 * @param {string} apiPath 完整接口路径（如 /api/v2/product/get_item_list）
 * @param {object} business 业务参数（不含公共参数）
 * @param {object} opts { shopId, signal, autoRefresh = true, method = 'POST' }
 *   method：查询类接口（get_* 与 search_* 开头）官方用 GET，需显式传 'GET'
 */
async function callOpenApi(apiPath, business = {}, opts = {}) {
  const store = require('../store');
  const { shopId, signal, method } = opts;
  const autoRefresh = opts.autoRefresh !== false;
  const app = resolveApp();
  const id = String(shopId || '');
  if (!id) throw new Error('缺少 shop_id');
  try {
    const fresh = await ensureFresh(app.env, id);
    const j = await signedCall({ env: app.env, apiPath, business, accessToken: fresh.accessToken, shopId: id, signal, method });
    store.clearShopInvalid(app.env, id);
    return j;
  } catch (e) {
    // 认证类错误：强制刷新一次后重试（一次机会，避免死循环）。
    // 必须带 force —— access_token 名义未过期但被网关拒绝时（例如凭证已被轮换、绑定到其它店铺），
    // 非强制刷新会直接复用同一个 token，重试必然再次失败，白白把店铺标记成「需重新授权」。
    // 网关存在拼写变体 invalid_acceess_token，以及 refresh token 失效的误导性文案，一并纳入
    if (autoRefresh && isAuthRetryable(e.message)) {
      try {
        const fresh = await ensureFresh(app.env, id, { force: true });
        const j = await signedCall({ env: app.env, apiPath, business, accessToken: fresh.accessToken, shopId: id, signal, method });
        store.clearShopInvalid(app.env, id);
        return j;
      } catch (e2) {
        // 已强制换新 token 后重试仍失败：用 isAuthFatalAfterRefresh（覆盖 error_auth / error_access_token）。
        // 这类错误不刷新就标失效会误杀，但刷新后仍报就是终态——否则店铺状态一直「有效」而调用一直报错。
        if (isAuthFatalAfterRefresh(e2.message)) store.markShopInvalid(app.env, id, e2.message);
        throw e2;
      }
    }
    if (isAuthDead(e.message)) store.markShopInvalid(app.env, id, e.message);
    throw e;
  }
}

module.exports = { callOpenApi };
