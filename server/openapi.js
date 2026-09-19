/**
 * Shopee 开放平台 API 登录模块（CommonJS）
 * 由合并服务 main.js 引入，通过 register({ get, post }) 注册路由（本文件只注册路由）。
 * 流程：录入 App（partner_id/partner_key）→ 生成授权链接 → 卖家浏览器授权
 *      → 跳回 /openapi/callback → 换取 access_token/refresh_token → 本地持久化。
 * 后续功能模块统一经 openapi/client.js 的 callOpenApi 调用官方接口，无需重复实现签名与刷新。
 *
 * 链路拆分到 openapi/ 子模块：
 *   constants.js     常量（API 路径 / 默认 redirect / 本机回调域名白名单）
 *   store.js         App 与店铺 token 持久化
 *   client.js        签名调用 / token 刷新（含分组续期）
 *   refresh-all.js   批量刷新编排（SSE + 暂停/取消）
 *   redirect.js      授权回调地址校验
 *   stores-view.js   已授权店铺列表（选择店铺数据源）
 *   callback-page.js 授权回调内联页
 *   notify.js        授权变化通知监控调度器
 */
'use strict';
const { sendJson, jsonAction } = require('./lib/http-utils');
const { DEFAULT_REDIRECT } = require('./openapi/constants');
const { nowSec, maskToken } = require('./lib/openapi-utils');
const store = require('./openapi/store');
const client = require('./openapi/client');
// 批量刷新 token 链路（分组编排 + SSE + 暂停/取消）拆在子模块，这里只注册路由
const refreshAll = require('./openapi/refresh-all');
const { validateRedirect } = require('./openapi/redirect');
const { authorizedStores } = require('./openapi/stores-view');
const { callbackPageHtml } = require('./openapi/callback-page');
const { notifyMonitorAuthChanged } = require('./openapi/notify');

// ============ 路由注册 ============
function register({ get, post }) {
  // 当前登录状态（token 一律打码）
  get('/api/openapi/status', (req, res) => {
    sendJson(res, 200, Object.assign({ ok: true }, store.status()));
  });

  // 已授权店铺列表（「选择店铺」数据源）：店铺ID + 店铺名
  get('/api/openapi/stores', async (req, res) => {
    try {
      sendJson(res, 200, await authorizedStores());
    } catch (e) {
      sendJson(res, 500, { ok: false, msg: `获取已授权店铺失败：${e.message}` });
    }
  });

  // 标记 / 取消「重点店铺」（在「③ 已授权店铺」勾选）：
  // 某环境有任一重点店铺时，监控大屏采集范围与 shopee_skill 取店范围都只作用于重点店铺；
  // 一个都没标记则回落为全部已授权店铺（判定源 store.getImportantIds，见 store.js）。
  post('/api/openapi/shop-important', jsonAction('/api/openapi/shop-important', (body, req, res) => {
    const shopId = String(body.shopId || '').trim();
    if (!shopId) throw new Error('缺少 shop_id');
    const app = store.getApp();
    if (!app) throw new Error('尚未配置 App，请先保存 partner_id / partner_key');
    if (!store.getShop(app.env, shopId)) throw new Error(`店铺 ${shopId} 尚未授权`);
    const important = !(body.important === false || body.important === 0
      || body.important === '0' || body.important === 'false');
    store.setShopImportant(app.env, shopId, important);
    notifyMonitorAuthChanged(); // 采集范围变化：立即刷新大屏店铺列表并按需补采
    const importantCount = store.getImportantIds(app.env).length;
    sendJson(res, 200, {
      ok: true,
      shopId,
      important,
      importantCount,
      message: important
        ? `已把店铺 ${shopId} 设为重点店铺（当前 ${importantCount} 个重点店铺）`
        : `已取消店铺 ${shopId} 的重点标记（当前 ${importantCount} 个重点店铺${importantCount === 0 ? '，已回落为全部已授权店铺' : ''}）`,
    });
  }));

  // 保存 App 配置（partner_id / partner_key / 环境）
  post('/api/openapi/app', jsonAction('/api/openapi/app', (body, req, res) => {
    const app = store.setApp({ partnerId: body.partnerId, partnerKey: body.partnerKey, env: body.env });
    if (app.shopsCleared) notifyMonitorAuthChanged(); // 换 App 后旧店铺凭证已清空，通知大屏刷新
    sendJson(res, 200, {
      ok: true,
      env: app.env,
      partnerId: app.partnerId,
      partnerKeyMasked: maskToken(app.partnerKey),
      shopsCleared: !!app.shopsCleared,
      message: app.shopsCleared
        ? 'App 配置已保存；检测到 partner_id 变更，该环境下原有店铺授权已清空（需重新授权）'
        : 'App 配置已保存（仅存于本机 server/data，不会上传）',
    });
  }));

  // 生成卖家授权链接
  post('/api/openapi/auth-url', jsonAction('/api/openapi/auth-url', async (body, req, res) => {
    const redirectInput = String(body.redirect || '').trim() || DEFAULT_REDIRECT;
    const { url: redirect, mode } = validateRedirect(redirectInput);
    const app = store.getApp();
    if (!app) throw new Error('尚未配置 App，请先保存 partner_id / partner_key');
    const { authUrl } = await client.getAuthUrl(app.env, redirect);
    sendJson(res, 200, {
      ok: true,
      authUrl,
      redirect,
      mode,
      message: mode === 'auto'
        ? '请复制链接在浏览器打开并选择店铺授权（授权后自动跳回本工具）'
        : '请复制链接在浏览器打开并选择店铺授权；授权后浏览器会跳到你的站点，把地址栏完整链接（含 code=…）复制回本工具「手动完成授权」粘贴',
    });
  }));

  // 授权回调：授权码换 token 并持久化。
  // 主账号授权时回调只有 code + main_account_id（无 shop_id），token/get 会返回 shop_id_list，
  // 对该主账号下全部已授权店铺统一保存同一对 token（账号级通用）。
  post('/api/openapi/auth-callback', jsonAction('/api/openapi/auth-callback', async (body, req, res) => {
    const code = String(body.code || '').trim();
    const shopId = String(body.shopId || '').trim();
    const mainAccountId = String(body.mainAccountId || '').trim();
    if (!code) throw new Error('缺少授权码 code');
    if (!shopId && !mainAccountId) {
      throw new Error('缺少 shop_id 或 main_account_id，请复制授权跳转后的完整地址栏链接');
    }
    const app = store.getApp();
    if (!app) throw new Error('尚未配置 App，请先保存 partner_id / partner_key');
    const t = await client.exchangeToken(app.env, { code, shopId, mainAccountId });
    const shops = t.authorizedShopIds.length ? t.authorizedShopIds : [];
    if (!shops.length) throw new Error('官方未返回店铺列表，请重新生成授权链接并授权');
    const accessExpireAt = nowSec() + t.expireIn;
    for (const id of shops) {
      store.setShop(app.env, id, {
        merchantId: t.merchantId,
        accessToken: t.accessToken,
        refreshToken: t.refreshToken,
        accessExpireAt,
        refreshedAt: Date.now(), // 授权即最新凭证，手动刷新冷却基准
        invalid: false, // 重新授权成功即恢复
        invalidReason: '',
        invalidAt: 0,
      });
    }
    console.log(`✅ 开放平台授权成功：${shops.length} 个店铺（${shops.join(', ')}，token 到期 ${new Date(accessExpireAt * 1000).toLocaleString('zh-CN', { hour12: false })}）`);
    notifyMonitorAuthChanged(); // 大屏立即恢复这些店铺的采集
    sendJson(res, 200, {
      ok: true,
      shopIds: shops,
      env: app.env,
      authorizedShopIds: t.authorizedShopIds,
      accessTokenMasked: maskToken(t.accessToken),
      message: `授权成功，已保存 ${shops.length} 个店铺`,
    });
  }));

  // 手动刷新某店铺 token：与自动续期共用 client.refreshShopNow，按该店 shop_id 刷新、只写回本店。
  // **不能**用 merchant_id 整组刷：实测刷出来的是商户级 token，拿它调店铺级接口报 invalid_acceess_token
  // （官方 refresh_access_token 要求 shop_id / merchant_id「必须分别刷新」，见 docs/开放平台链路.md §3）。
  post('/api/openapi/refresh', jsonAction('/api/openapi/refresh', async (body, req, res) => {
    const shopId = String(body.shopId || '').trim();
    if (!shopId) throw new Error('缺少 shop_id');
    const app = store.getApp();
    if (!app) throw new Error('尚未配置 App，请先保存 partner_id / partner_key');
    const shop = store.getShop(app.env, shopId);
    if (!shop) throw new Error(`店铺 ${shopId} 尚未授权`);
    if (shop.invalid) {
      throw new Error(`店铺 ${shopId} 授权已失效：${shop.invalidReason || '凭证无效'}，重新授权后才能恢复`);
    }
    const r = await client.refreshShopNow(app.env, shopId);
    notifyMonitorAuthChanged(); // 刷新成功即恢复采集
    sendJson(res, 200, {
      ok: true,
      shopId,
      syncedShops: r.synced,
      mode: r.mode,
      accessTokenMasked: maskToken(r.accessToken),
      accessExpireAt: r.accessExpireAt,
      message: r.mode === 'cooldown'
        // 冷却：距上次刷新不足 REFRESH_COOLDOWN_MS，当前 token 仍有效，未重复请求网关（防连点刷死凭证）
        ? `距上次刷新不足 ${Math.round(client.REFRESH_COOLDOWN_MS / 60000)} 分钟，当前 token 仍在有效期内，未重复刷新`
        : 'Token 刷新成功（旧 refresh_token 已失效）',
    });
  }));

  // 批量刷新全部已授权店铺的 token（SSE 流式进度）：内部按共享 token 分组去重，
  // 每组只刷一次（逐店刷新会作废旧 refresh_token、把同组店铺拖成「需重新授权」，见 refresh-all.js）
  refreshAll.register({ post });

  // 删除某店铺授权（幂等）
  post('/api/openapi/remove-shop', jsonAction('/api/openapi/remove-shop', (body, req, res) => {
    const shopId = String(body.shopId || '').trim();
    if (!shopId) throw new Error('缺少 shop_id');
    const app = store.getApp();
    const removed = app ? store.removeShop(app.env, shopId) : false;
    if (removed) notifyMonitorAuthChanged();
    sendJson(res, 200, { ok: true, removed, message: removed ? '已删除店铺授权' : '该店铺本就没有授权记录' });
  }));

  // 测试登录：用店铺 token 调 get_shop_info（GET 查询类接口）验证有效性并返回店铺名
  post('/api/openapi/test', jsonAction('/api/openapi/test', async (body, req, res) => {
    const shopId = String(body.shopId || '').trim();
    if (!shopId) throw new Error('缺少 shop_id');
    const info = await client.callOpenApi('/api/v2/shop/get_shop_info', {}, { shopId, method: 'GET' });
    const shopName = String(info.shop_name || (info.data && info.data.shop_name) || '未知店铺名');
    sendJson(res, 200, { ok: true, shopId, shopName, message: `登录有效，店铺名：${shopName}` });
  }));

  // 官方授权页跳回地址（内联 HTML，读取 query 后自动换取 token）
  get('/openapi/callback', (req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(callbackPageHtml());
  });
}

module.exports = { register, _test: { validateRedirect } };
