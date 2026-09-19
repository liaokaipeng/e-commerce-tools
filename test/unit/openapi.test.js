'use strict';
// 单元测试：开放平台签名纯函数、回调地址校验、凭证失效判定与刷新计划。
const crypto = require('crypto');
const { t } = require('../helpers');
const { nowSec, buildBaseString, hmacHex, maskToken } = require('../../server/lib/openapi-utils');
const openapi = require('../../server/openapi');
const { isAuthDead, isAuthRetryable, isAuthFatalAfterRefresh } = require('../../server/openapi/client');

async function run() {
  // ===== 开放平台：签名纯函数 =====
  t('nowSec 为整数秒且接近当前时间', Number.isInteger(nowSec()) && Math.abs(nowSec() - Date.now() / 1000) < 5, String(nowSec()));
  t('buildBaseString 无 token = partner_id+api_path+timestamp', buildBaseString('p1', '/api/v2/auth/token/get', 100) === 'p1/api/v2/auth/token/get100');
  t('buildBaseString 带 token = +access_token+shop_id', buildBaseString('p1', '/api/v2/x', 100, 'acc', 'shop') === 'p1/api/v2/x100accshop');
  t('buildBaseString 仅 access_token 时只拼 token', buildBaseString('p1', '/api/v2/x', 100, 'acc', '') === 'p1/api/v2/x100acc');
  t('buildBaseString 仅 shop_id 时只拼 shop_id', buildBaseString('p1', '/api/v2/x', 100, '', 'shop') === 'p1/api/v2/x100shop');
  t('hmacHex 与 crypto 标准实现一致', hmacHex('key', 'data') === crypto.createHmac('sha256', 'key').update('data').digest('hex'));
  t('hmacHex 输出小写 64 位 hex', /^[0-9a-f]{64}$/.test(hmacHex('k', 'd')));
  t('maskToken 保留前 8 后 4 位', maskToken('abcdefghijklmnop') === 'abcdefgh***mnop', maskToken('abcdefghijklmnop'));
  t('maskToken 短串保留首尾', maskToken('abc') === 'a***c', maskToken('abc'));
  t('maskToken 空串返回空', maskToken('') === '' && maskToken(null) === '');

  // ===== 开放平台：redirect 校验（自动回调 / 手动粘贴两种模式） =====
  {
    const { validateRedirect } = openapi._test;
    const ok = (url, mode) => {
      try { return validateRedirect(url).mode === mode; } catch { return false; }
    };
    const bad = (url) => {
      try { validateRedirect(url); return false; } catch { return true; }
    };
    t('redirect 127.0.0.1 本机地址 → auto', ok('http://127.0.0.1:8765/openapi/callback', 'auto'));
    t('redirect localhost → auto', ok('http://localhost:8765/openapi/callback', 'auto'));
    t('redirect sslip.io 通配域名 → auto', ok('http://127.0.0.1.sslip.io:8765/openapi/callback', 'auto'));
    t('redirect localtest.me / lvh.me → auto', ok('http://localtest.me:8765/openapi/callback', 'auto') && ok('http://lvh.me:8765/openapi/callback', 'auto'));
    t('redirect 本机地址端口不对 → 拒绝', bad('http://127.0.0.1:9999/openapi/callback'));
    t('redirect 本机地址路径不对 → 拒绝', bad('http://127.0.0.1:8765/other'));
    t('redirect 非白名单 http 域名 → manual（手动粘贴兜底）', ok('http://my.example.com/cb', 'manual'));
    t('redirect IP 地址（http）→ 拒绝', bad('http://1.2.3.4/cb'));
    t('redirect https 域名 → manual（手动粘贴兜底）', ok('https://my.example.com/cb', 'manual'));
    t('redirect 带查询参数 → 拒绝（官方要求不含 ?）', bad('https://my.example.com/cb?x=1'));
    t('redirect https 带端口域名 → manual', ok('https://my.example.com:8443/cb', 'manual'));
    t('redirect https 但 host 是 IP → 拒绝', bad('https://1.2.3.4/cb'));
    t('redirect 非 http(s) 协议 → 拒绝', bad('ftp://x.example.com/cb') && bad('not-a-url'));
  }

  // ===== 开放平台：凭证失效判定与刷新计划（纯函数） =====
  t('isAuthDead 命中网关 invalid_acceess_token 文案', isAuthDead('开放平台错误 invalid_acceess_token：Invalid access_token, please have a check.') === true);
  t('isAuthDead 命中 refresh token/shop_id 不匹配文案', isAuthDead('error_param：Your refresh token or shop_id is wrong, please check refresh token or shop_id.') === true);
  t('isAuthDead 命中 refresh token/merchant_id 不匹配文案', isAuthDead('error_param：Your refresh token or merchant_id is wrong') === true);
  t('isAuthDead 命中 refresh_token 过期文案', isAuthDead('error_refresh_token：Your refresh_token expired.') === true);
  t('isAuthDead 不命中普通业务/网络错误', isAuthDead('开放平台错误 error_param：缺少必填参数') === false && isAuthDead('连接超时') === false);
  t('isAuthRetryable 认证类错误可刷新重试', isAuthRetryable('开放平台错误 error_access_token：xxx') === true && isAuthRetryable('开放平台错误 invalid_acceess_token：Invalid access_token, please have a check.') === true);
  t('isAuthRetryable 普通错误不重试', isAuthRetryable('商品清单：接口超时') === false);
  t('isAuthFatalAfterRefresh 命中「已换新 token 仍报」的 error_auth / error_access_token',
    isAuthFatalAfterRefresh('开放平台错误 error_auth：Invalid access_token, please have a check.') === true
      && isAuthFatalAfterRefresh('开放平台错误 error_access_token：xxx') === true);
  t('isAuthFatalAfterRefresh 覆盖 isAuthDead 文案',
    isAuthFatalAfterRefresh('开放平台错误 invalid_acceess_token：Invalid access_token, please have a check.') === true);
  t('isAuthFatalAfterRefresh 不误伤业务子码 error_auth_*',
    isAuthFatalAfterRefresh('开放平台错误 error_auth_product_is_pff：product is pff') === false
      && isAuthFatalAfterRefresh('开放平台错误 error_auth_shop_not_found：x') === false);
  t('isAuthFatalAfterRefresh 不命中权限/普通错误',
    isAuthFatalAfterRefresh('开放平台错误 error_permission：no permission') === false
      && isAuthFatalAfterRefresh('连接超时') === false);
}

module.exports = { run };
