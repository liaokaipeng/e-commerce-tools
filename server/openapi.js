/**
 * Shopee 开放平台 API 登录模块（CommonJS）
 * 由合并服务 main.js 引入，通过 register({ get, post }) 注册路由。
 * 流程：录入 App（partner_id/partner_key）→ 生成授权链接 → 卖家浏览器授权
 *      → 跳回 /openapi/callback → 换取 access_token/refresh_token → 本地持久化。
 * 后续功能模块统一经 openapi/client.js 的 callOpenApi 调用官方接口，无需重复实现签名与刷新。
 */
'use strict';
const { sendJson, readBody } = require('./lib/http-utils');
const { DEFAULT_REDIRECT, LOCAL_REDIRECT_HOSTS } = require('./openapi/constants');
const { nowSec, maskToken } = require('./lib/openapi-utils');
const store = require('./openapi/store');
const client = require('./openapi/client');

/**
 * 校验授权回调地址，返回 { url, mode }：
 * - auto：http + 本机可达域名（白名单，解析到 127.0.0.1）+ 8765 + /openapi/callback，授权后自动跳回本工具换 token。
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
    u.port === '8765' &&
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
      'redirect 不合法：自动回调需为本机可达地址（http://<本机域名>:8765/openapi/callback，可用 ' +
        LOCAL_REDIRECT_HOSTS.join(' / ') +
        '）；或填你自己的 http/https 域名地址（不能带 ? 查询参数），授权后把跳转链接粘贴回本工具「手动完成授权」，或在你的域名放转发页实现全自动'
    );
  }
  return { url: u.toString(), mode: local ? 'auto' : 'manual' };
}

/** 统一读 body 并兜底解析 */
async function parseBody(req) {
  try {
    return JSON.parse(await readBody(req));
  } catch (e) {
    throw new Error('请求体不是合法 JSON：' + e.message);
  }
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

  // 保存 App 配置（partner_id / partner_key / 环境）
  post('/api/openapi/app', async (req, res) => {
    try {
      const body = await parseBody(req);
      const app = store.setApp({ partnerId: body.partnerId, partnerKey: body.partnerKey, env: body.env });
      sendJson(res, 200, {
        ok: true,
        env: app.env,
        partnerId: app.partnerId,
        partnerKeyMasked: maskToken(app.partnerKey),
        message: 'App 配置已保存（仅存于本机 server/data，不会上传）',
      });
    } catch (e) {
      sendJson(res, 400, { ok: false, message: e.message });
    }
  });

  // 生成卖家授权链接
  post('/api/openapi/auth-url', async (req, res) => {
    try {
      const body = await parseBody(req);
      const redirectInput = String(body.redirect || '').trim() || DEFAULT_REDIRECT;
      const { url: redirect, mode } = validateRedirect(redirectInput);
      const app = store.getApp();
      if (!app) throw new Error('尚未配置 App，请先保存 partner_id / partner_key');
      const { authUrl, expire } = await client.getAuthUrl(app.env, redirect);
      sendJson(res, 200, {
        ok: true,
        authUrl,
        expire,
        redirect,
        mode,
        message: mode === 'auto'
          ? '请复制链接在浏览器打开并选择店铺授权（授权后自动跳回本工具）'
          : '请复制链接在浏览器打开并选择店铺授权；授权后浏览器会跳到你的站点，把地址栏完整链接（含 code=…）复制回本工具「手动完成授权」粘贴',
      });
    } catch (e) {
      sendJson(res, 400, { ok: false, message: e.message });
    }
  });

  // 授权回调：授权码换 token 并持久化。
  // 主账号授权时回调只有 code + main_account_id（无 shop_id），token/get 会返回 shop_id_list，
  // 对该主账号下全部已授权店铺统一保存同一对 token（账号级通用）。
  post('/api/openapi/auth-callback', async (req, res) => {
    try {
      const body = await parseBody(req);
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
        });
      }
      console.log(`✅ 开放平台授权成功：${shops.length} 个店铺（${shops.join(', ')}，token 到期 ${new Date(accessExpireAt * 1000).toLocaleString('zh-CN', { hour12: false })}）`);
      sendJson(res, 200, {
        ok: true,
        shopIds: shops,
        env: app.env,
        authorizedShopIds: t.authorizedShopIds,
        accessTokenMasked: maskToken(t.accessToken),
        message: `授权成功，已保存 ${shops.length} 个店铺`,
      });
    } catch (e) {
      sendJson(res, 400, { ok: false, message: e.message });
    }
  });

  // 手动刷新某店铺 token（旧 refresh_token 刷新后立即失效，成功后自动落盘）
  post('/api/openapi/refresh', async (req, res) => {
    try {
      const body = await parseBody(req);
      const shopId = String(body.shopId || '').trim();
      if (!shopId) throw new Error('缺少 shop_id');
      const app = store.getApp();
      if (!app) throw new Error('尚未配置 App，请先保存 partner_id / partner_key');
      const shop = store.getShop(app.env, shopId);
      if (!shop) throw new Error(`店铺 ${shopId} 尚未授权`);
      const fresh = await client.refreshToken(app.env, shopId, shop.refreshToken);
      store.setShop(app.env, shopId, {
        accessToken: fresh.accessToken,
        refreshToken: fresh.refreshToken,
        accessExpireAt: nowSec() + fresh.expireIn,
      });
      sendJson(res, 200, {
        ok: true,
        shopId,
        accessTokenMasked: maskToken(fresh.accessToken),
        accessExpireAt: nowSec() + fresh.expireIn,
        message: 'Token 刷新成功（旧 refresh_token 已失效）',
      });
    } catch (e) {
      sendJson(res, 400, { ok: false, message: e.message });
    }
  });

  // 删除某店铺授权（幂等）
  post('/api/openapi/remove-shop', async (req, res) => {
    try {
      const body = await parseBody(req);
      const shopId = String(body.shopId || '').trim();
      if (!shopId) throw new Error('缺少 shop_id');
      const app = store.getApp();
      const removed = app ? store.removeShop(app.env, shopId) : false;
      sendJson(res, 200, { ok: true, removed, message: removed ? '已删除店铺授权' : '该店铺本就没有授权记录' });
    } catch (e) {
      sendJson(res, 400, { ok: false, message: e.message });
    }
  });

  // 测试登录：用店铺 token 调 get_shop_info（GET 查询类接口）验证有效性并返回店铺名
  post('/api/openapi/test', async (req, res) => {
    try {
      const body = await parseBody(req);
      const shopId = String(body.shopId || '').trim();
      if (!shopId) throw new Error('缺少 shop_id');
      const info = await client.callOpenApi('/api/v2/shop/get_shop_info', {}, { shopId, method: 'GET' });
      const shopName = String(info.shop_name || (info.data && info.data.shop_name) || '未知店铺名');
      sendJson(res, 200, { ok: true, shopId, shopName, message: `登录有效，店铺名：${shopName}` });
    } catch (e) {
      sendJson(res, 400, { ok: false, message: e.message });
    }
  });

  // 官方授权页跳回地址（内联 HTML，读取 query 后自动换取 token）
  get('/openapi/callback', (req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(callbackPageHtml());
  });
}

module.exports = { register, _test: { validateRedirect } };
