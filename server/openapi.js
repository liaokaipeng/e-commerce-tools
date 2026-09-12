/**
 * Shopee 开放平台 API 登录模块（CommonJS）
 * 由合并服务 main.js 引入，通过 register({ get, post }) 注册路由。
 * 流程：录入 App（partner_id/partner_key）→ 生成授权链接 → 卖家浏览器授权
 *      → 跳回 /openapi/callback → 换取 access_token/refresh_token → 本地持久化。
 * 后续功能模块统一经 openapi/client.js 的 callOpenApi 调用官方接口，无需重复实现签名与刷新。
 */
'use strict';
const { sendJson, jsonAction } = require('./lib/http-utils');
const { CALLBACK_PORT } = require('./lib/config');
const { DEFAULT_REDIRECT, LOCAL_REDIRECT_HOSTS, API_PATH } = require('./openapi/constants');
const { nowSec, maskToken } = require('./lib/openapi-utils');
const store = require('./openapi/store');
const client = require('./openapi/client');

/**
 * 校验授权回调地址，返回 { url, mode }：
 * - auto：http + 本机可达域名（白名单，解析到 127.0.0.1）+ 回调端口（CALLBACK_PORT，默认 8765）+ /openapi/callback，授权后自动跳回本工具换 token。
 * - manual：任意 http/https 域名（官方后台强制要求域名时用）：授权后浏览器跳到该地址，
 *   用户把地址栏里的完整回调链接（含 code/shop_id）复制回本工具「手动完成授权」粘贴；
 *   也可以在该域名上放一个转发页自动跳回本机（见前端「有域名」折叠说明）。
 * 注意：官方后台对 redirect 做域名校验，不接受 127.0.0.1 / localhost 时请用白名单里的通配域名。
 */
function validateRedirect(redirect) {
  let u;
  try {
    u = new URL(String(redirect || ''));
  } catch (e) {
    throw new Error('redirect 不是合法地址');
  }
  const host = u.hostname.toLowerCase();
  const local =
    u.protocol === 'http:' &&
    u.port === String(CALLBACK_PORT) &&
    u.pathname === '/openapi/callback' &&
    !u.search &&
    LOCAL_REDIRECT_HOSTS.includes(host);
  const manual =
    (u.protocol === 'http:' || u.protocol === 'https:') &&
    !u.search && // 官方要求 redirect 不能带查询参数
    !/^\d+\.\d+\.\d+\.\d+$/.test(host) && // 官方后台不接受 IP 字面量，手动模式同样拒绝
    /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i.test(host);
  if (!local && !manual) {
    throw new Error(
      `redirect 不合法：自动回调需为本机可达地址（http://<本机域名>:${CALLBACK_PORT}/openapi/callback，可用 ` +
        LOCAL_REDIRECT_HOSTS.join(' / ') +
        '）；或填你自己的 http/https 域名地址（不能带 ? 查询参数），授权后把跳转链接粘贴回本工具「手动完成授权」，或在你的域名放转发页实现全自动'
    );
  }
  return { url: u.toString(), mode: local ? 'auto' : 'manual' };
}

/** 授权状态变化后通知监控大屏调度器立即刷新店铺列表（重新授权后无需等巡检周期，大屏当场恢复） */
function notifyMonitorAuthChanged() {
  try {
    require('./monitor/scheduler').notifyAuthChanged();
  } catch { /* 监控模块未加载时忽略 */ }
}

// ============ 已授权店铺列表（各工具「选择店铺」数据源） ============
// 输出当前环境全部已授权店铺的 { category, id, name, region }（与 /api/stores 同构 + region 国家筛选用）。
// 店铺名/地区三级缓存：openapi-session.json(shopName/shopRegion) → 监控 meta.json(首次采集时补的名字) → stores.json；
// 两处都缺才调 get_shop_info 补拉（直接签名调用、不带自动刷新），失败只记失败时间戳、
// 10 分钟内不重试——取名/取地区失败绝不把店铺标记为失效（不影响监控采集与授权状态）。
const SHOP_NAME_RETRY_MS = 10 * 60 * 1000;
const SHOP_NAME_CONCURRENCY = 5;
let shopNameTask = null; // 单飞：并发请求共享同一次拉取，避免重复打网关

/** 监控大屏缓存的店铺名（meta.json，首次采集时经 get_shop_info 补过） */
function monitorNameMap() {
  try {
    const meta = require('./monitor/store').getMeta();
    const out = {};
    for (const [id, m] of Object.entries((meta && meta.shops) || {})) {
      if (m && m.name) out[String(id)] = String(m.name);
    }
    return out;
  } catch { return {}; } // 监控模块不可用时忽略
}

/** stores.json（手工维护的店铺清单）里的店铺名 */
function storesNameMap() {
  try {
    const list = require('./lib/shopee-session').loadStores();
    const out = {};
    for (const s of Array.isArray(list) ? list : []) {
      if (s && s.id && s.name) out[String(s.id)] = String(s.name);
    }
    return out;
  } catch { return {}; }
}

/** 直调 get_shop_info 补拉缺失的店铺名/地区（不走 callOpenApi：避免认证类失败触发刷新/标记失效） */
async function fetchShopNames(env, shops) {
  let cursor = 0;
  const worker = async () => {
    while (cursor < shops.length) {
      const s = shops[cursor++];
      const patch = {};
      try {
        const j = await client.signedCall({
          env,
          apiPath: API_PATH.getShopInfo,
          accessToken: s.accessToken || '',
          shopId: s.shopId,
          method: 'GET',
        });
        // 载荷层口径与 client.pickPayload 统一（顶层 / response / data）
        const p = client.pickPayload(j, ['shop_name', 'region', 'country', 'shop_region', 'shop_country']) || {};
        let name = p.shop_name ? String(p.shop_name) : '';
        let region = '';
        // region 提取口径与监控采集（collectors.fetchShopInfo）一致
        for (const k of ['region', 'country', 'shop_region', 'shop_country']) {
          if (p[k] !== undefined && p[k] !== null && p[k] !== '') { region = String(p[k]).toUpperCase(); break; }
        }
        if (name.trim()) patch.shopName = name.trim();
        else patch.shopNameFailedAt = Date.now();
        if (region) patch.shopRegion = region;
        else patch.shopRegionFailedAt = Date.now();
      } catch (e) {
        patch.shopNameFailedAt = Date.now();
        patch.shopRegionFailedAt = Date.now();
        console.warn(`获取店铺 ${s.shopId} 名称/地区失败: ${e.message}`);
      }
      store.setShop(env, s.shopId, patch);
    }
  };
  await Promise.all(Array.from({ length: Math.min(SHOP_NAME_CONCURRENCY, shops.length) }, worker));
}

/** 已授权店铺列表（首次调用会补拉缺失的店铺名/地区，耗时几秒；之后走缓存秒回） */
async function authorizedStores() {
  const app = store.getApp();
  if (!app) return [];
  const mNames = monitorNameMap();
  const sNames = storesNameMap();
  const now = Date.now();
  const pending = store
    .getShopsRaw(app.env)
    .filter((s) => {
      if (s.invalid) return false;
      const hasName = !!(s.shopName || mNames[s.shopId] || sNames[s.shopId]);
      const hasRegion = !!s.shopRegion;
      if (hasName && hasRegion) return false;
      const nameBlocked = s.shopNameFailedAt && now - s.shopNameFailedAt < SHOP_NAME_RETRY_MS;
      const regionBlocked = s.shopRegionFailedAt && now - s.shopRegionFailedAt < SHOP_NAME_RETRY_MS;
      // 名字/地区各自有 10 分钟失败冷却，两项都被冷却挡住时才跳过
      if (!hasName && !hasRegion) return !(nameBlocked && regionBlocked);
      if (!hasName) return !nameBlocked;
      return !regionBlocked;
    });
  if (pending.length) {
    if (!shopNameTask) {
      shopNameTask = fetchShopNames(app.env, pending).finally(() => {
        shopNameTask = null;
      });
    }
    await shopNameTask;
  }
  return store
    .getShopsRaw(app.env)
    // 失效店铺不作为可选目标（选中后调用必然失败）；其状态仍在 /api/openapi/status 与监控大屏展示
    .filter((s) => !s.invalid)
    .map((s) => ({
      category: '开放平台已授权',
      id: s.shopId,
      name: s.shopName || mNames[s.shopId] || sNames[s.shopId] || `店铺 ${s.shopId}`,
      region: s.shopRegion || '',
    }))
    .sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
}

// ============ 授权回调页（浏览器从官方授权页跳回这里） ============
// 内联 HTML：读取 query 中的 code/shop_id/main_account_id，调 /api/openapi/auth-callback 换 token。
function callbackPageHtml() {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>开放平台授权回调</title>
<style>
  body { font-family: "Microsoft YaHei", sans-serif; background: #f4f6fb; display: flex; min-height: 100vh; align-items: center; justify-content: center; margin: 0; }
  .card { background: #fff; border-radius: 12px; box-shadow: 0 6px 24px rgba(0,0,0,.08); padding: 32px 40px; max-width: 560px; text-align: center; }
  h2 { margin: 0 0 12px; color: #23262f; }
  p { color: #4a5064; line-height: 1.7; word-break: break-all; }
  .ok h2 { color: #0a9d5c; } .fail h2 { color: #d64541; }
  .spinner { display: inline-block; width: 28px; height: 28px; border: 3px solid #e0e3ee; border-top-color: #ee4d2d; border-radius: 50%; animation: spin 0.8s linear infinite; margin-bottom: 12px; }
  @keyframes spin { to { transform: rotate(360deg); } }
</style>
</head>
<body>
<div class="card" id="card">
  <div class="spinner"></div>
  <h2>正在完成店铺授权…</h2>
  <p>正在用授权码换取访问令牌，请稍候。</p>
</div>
<script>
  (async function () {
    var card = document.getElementById('card');
    var q = new URLSearchParams(location.search);
    function show(ok, title, detail) {
      card.className = 'card ' + (ok ? 'ok' : 'fail');
      card.innerHTML = '<h2>' + title + '</h2><p>' + detail + '</p>';
      setTimeout(function () { location.href = '/'; }, 4000);
    }
    var code = q.get('code');
    var shopId = q.get('shop_id');
    var mainId = q.get('main_account_id');
    if (q.get('error')) { show(false, '授权被取消或失败', '官方授权页返回错误：' + q.get('error') + '。请回到「开放平台」页面重新生成授权链接。'); return; }
    if (!code) { show(false, '回调参数不完整', '未收到 code。请回到「开放平台」页面重新生成授权链接并重新授权。'); return; }
    if (!shopId && !mainId) { show(false, '回调参数不完整', '未收到 shop_id 或 main_account_id。请回到「开放平台」页面重新生成授权链接并重新授权。'); return; }
    try {
      var r = await fetch('/api/openapi/auth-callback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: code, shopId: shopId || '', mainAccountId: mainId || '' }),
      });
      var j = await r.json();
      if (r.ok && j.ok) {
        var cnt = (j.shopIds && j.shopIds.length) || 0;
        show(true, '店铺授权成功', '已授权并保存 ' + cnt + ' 个店铺，即将返回工具首页。可在「开放平台」页面查看和管理 Token。');
      } else {
        show(false, '换取令牌失败', (j.message || '未知错误') + '。请回到「开放平台」页面重新生成授权链接。');
      }
    } catch (e) {
      show(false, '本地服务异常', '调用本地服务失败：' + e.message + '。请确认 启动.bat 正在运行后重试。');
    }
  })();
</script>
</body>
</html>`;
}

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

  // 手动刷新某店铺 token：与自动续期共用 client.refreshShopNow 的分组决策 ——
  // 共享主账号 token 的店铺整组续期（旧 refresh_token 一次性作废，单店刷新会拖死同组其它店铺）。
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
      message: r.synced > 1
        ? `Token 刷新成功，已同步续期同组 ${r.synced} 个店铺（旧 refresh_token 已失效）`
        : 'Token 刷新成功（旧 refresh_token 已失效）',
    });
  }));

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
