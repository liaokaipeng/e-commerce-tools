'use strict';
// 开放平台授权与 App 解析：生成卖家授权链接、授权码换 token，以及测试用 get_shop_info。
const { ENV_HOSTS, API_PATH } = require('../constants');
const { nowSec } = require('../../lib/openapi-utils');
const { commonParams, qsOf } = require('./sign');
const { signedCall } = require('./transport');
const { pickPayload } = require('./parse');

/** 取 App 配置，未配置直接抛出可执行中文提示 */
function resolveApp() {
  const store = require('../store');
  const app = store.getApp();
  if (!app) throw new Error('尚未配置开放平台 App，请先在「开放平台」页面保存 partner_id / partner_key');
  return app;
}

/**
 * 生成卖家授权链接（GET URL 本地拼接，不发起接口调用）：
 * https://partner.<host>/api/v2/shop/auth_partner?partner_id=…&timestamp=…&sign=…&redirect=…
 * 链接约 30 分钟有效，卖家打开后登录选店授权。
 */
function getAuthUrl(env, redirect) {
  const app = resolveApp();
  const host = ENV_HOSTS[env];
  if (!host) throw new Error('无效的环境：' + env);
  const timestamp = nowSec();
  const common = commonParams({ partnerId: app.partnerId, partnerKey: app.partnerKey, apiPath: API_PATH.authPartner, timestamp });
  const params = Object.assign({}, common, { redirect });
  const authUrl = `${host}${API_PATH.authPartner}?${qsOf(params)}`;
  return { authUrl };
}

/**
 * 授权码换 token：POST /api/v2/auth/token/get（业务参数 code/shop_id/main_account_id 放 body）。
 * 主账号授权时回调只带 code + main_account_id（无 shop_id），这里用 main_account_id 换，
 * 官方返回 shop_id_list（该主账号下全部已授权店铺）。
 */
async function exchangeToken(env, { code, shopId, mainAccountId }) {
  const business = { code };
  if (shopId) business.shop_id = shopId;
  if (mainAccountId) business.main_account_id = mainAccountId;
  const raw = await signedCall({ env, apiPath: API_PATH.tokenGet, business });
  const j = pickPayload(raw, ['access_token', 'refresh_token']);
  if (!j.access_token || !j.refresh_token) {
    throw new Error('未获取到 access_token / refresh_token');
  }
  const merchantId = Array.isArray(j.merchant_id_list) && j.merchant_id_list[0] ? String(j.merchant_id_list[0]) : '';
  const authorizedShopIds = Array.isArray(j.shop_id_list) && j.shop_id_list.length
    ? j.shop_id_list.map(String)
    : shopId ? [String(shopId)] : [];
  return {
    accessToken: j.access_token,
    refreshToken: j.refresh_token,
    expireIn: j.expire_in || 0,
    merchantId,
    authorizedShopIds,
  };
}

/** 测试用：拉取店铺信息验证 token 有效性（get_shop_info 为 GET 查询类接口） */
async function getShopInfo(env, shopId, accessToken) {
  const j = await signedCall({ env, apiPath: API_PATH.getShopInfo, accessToken, shopId, method: 'GET' });
  const name = j.shop_name || (j.data && j.data.shop_name) || '';
  return { shopId: String(shopId), shopName: String(name) };
}

module.exports = { resolveApp, getAuthUrl, exchangeToken, getShopInfo };
