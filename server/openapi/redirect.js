'use strict';
// 授权回调地址校验（纯函数，便于单测）。
const { CALLBACK_PORT } = require('../lib/config');
const { LOCAL_REDIRECT_HOSTS } = require('./constants');

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

module.exports = { validateRedirect };
