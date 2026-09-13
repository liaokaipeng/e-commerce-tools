'use strict';
// 开放平台 HTTP 传输层：签名并发送 signedCall 请求（网络错误 / 5xx 退避重试，业务错误不重试）。
// 只负责「把一次签名请求发出去并按错误文案抛错」，刷新分组 / token 有效期等策略不在此层。
const http = require('../../lib/http');
const { ENV_HOSTS } = require('../constants');
const { nowSec } = require('../../lib/openapi-utils');
const { commonParams, qsOf } = require('./sign');
const { hintOf } = require('./errors');
// 重试 / 退避统一走 lib/retry.js（与视频上传、TikTok 解析等链路共用同一骨架）
const { retry, fixedBackoff } = require('../../lib/retry');

/**
 * 签名请求到开放平台网关。
 * 方法约定（以官方网关实测与 SDK 路由表为准）：
 * - GET（查询类接口，如 get_shop_info）：公共参数 + 业务参数全部放 query，无 body；
 * - POST（写操作 / 换 token 等）：公共参数放 query，业务参数放 JSON body；
 * 网络错误 / 5xx 退避重试 1 次；4xx 与业务 error 不重试。
 * @param {object} opts { env, apiPath, business, accessToken, shopId, signal, method = 'POST' }
 */
async function signedCall({ env, apiPath, business = {}, accessToken = '', shopId = '', signal, method = 'POST' }) {
  const store = require('../store'); // 延迟 require：测试按缓存清理隔离凭证实例，此处必须取最新实例
  const app = store.getApp();
  if (!app) throw new Error('尚未配置开放平台 App，请先在「开放平台」页面保存 partner_id / partner_key');
  const host = ENV_HOSTS[env];
  if (!host) throw new Error('无效的环境：' + env);

  const timestamp = nowSec();
  const common = commonParams({ partnerId: app.partnerId, partnerKey: app.partnerKey, apiPath, timestamp, accessToken, shopId });

  const m = String(method).toUpperCase();
  let url;
  let body = null;
  let headers = {};
  if (m === 'GET') {
    url = `${host}${apiPath}?${qsOf(Object.assign({}, common, business))}`;
  } else {
    url = `${host}${apiPath}?${qsOf(common)}`;
    headers = { 'Content-Type': 'application/json' };
    body = JSON.stringify(business);
  }

  const maxAttempts = 2;
  // 退避与重试骨架统一走 lib/retry.js（固定 1s 间隔：网关限流窗口固定，指数退避无收益）
  return retry(async () => {
    const resp = await http.request({
      method: m,
      url,
      headers,
      body,
      timeout: 30000,
      signal,
    });
    const j = resp.json;
    if (!j || typeof j !== 'object') {
      // 5xx 多为网关瞬时故障，交给 retry；其余（含 4xx 非 JSON）视为终态错误
      if (resp.status >= 500 && resp.status < 600) throw new Error(`开放平台网关返回 HTTP ${resp.status}`);
      throw new Error(`开放平台返回异常（HTTP ${resp.status}）: ${(resp.text || '').slice(0, 200)}`);
    }
    if (j.error) {
      const hint = hintOf(j.error, j.message);
      throw new Error(`开放平台错误 ${j.error}${j.message ? '：' + j.message : ''}${hint ? '（' + hint + '）' : ''}`);
    }
    return j;
  }, {
    attempts: maxAttempts,
    waitOf: fixedBackoff(1000),
    // 业务错误不重试（避免重复副作用）；仅网络 / 5xx 重试
    shouldRetry: (e) => !(e.message && e.message.includes('开放平台错误')),
    isAborted: () => !!(signal && signal.aborted),
  });
}

module.exports = { signedCall };
