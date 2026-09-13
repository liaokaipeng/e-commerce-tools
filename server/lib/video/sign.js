'use strict';
/**
 * Vod 凭证解密与 AWS SigV4 签名（无网络依赖，可独立单元测试）
 * 供视频上传链路获取 / 校验凭证与 PH 本土 vod 上传签名使用。
 */
const crypto = require('crypto');
const { hmac, sha256hex } = require('./hash');

/**
 * 解密 preupload 返回的加密凭证（token / access_key）。
 * 前端 MMS SDK 逻辑：AES-128-CBC，key="shopee_vod_"+biz 左补 0 到 5 位，iv 固定，PKCS7。
 * 解密失败时返回原值兜底。
 */
function decryptVodToken(b64, biz) {
  try {
    const key = Buffer.from('shopee_vod_' + String(biz).padStart(5, '0'));
    const iv = Buffer.from('1234567887654321');
    const d = crypto.createDecipheriv('aes-128-cbc', key, iv);
    return Buffer.concat([d.update(Buffer.from(b64, 'base64')), d.final()]).toString('utf8');
  } catch (e) {
    return b64;
  }
}

/**
 * AWS SigV4 签名（S3/COS 兼容，PH 本土 vod 上传使用）。
 * 流式 body 场景：调用方先流式计算 sha256 后经 payloadSha256 传入（body 不再参与计算）。
 * @param {object} o { method, host, path, query, headers, body, payloadSha256, accessKey, secretKey, sessionToken, region, service }
 * @returns {object} 需要追加到请求里的签名头（Authorization / x-amz-date / x-amz-security-token / x-amz-content-sha256）
 */
function awsSigV4(o) {
  const now = new Date();
  const amzDate = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const dateStamp = amzDate.slice(0, 8);
  const region = o.region || 'us-east-1';
  const service = o.service || 's3';

  const payloadHash = o.payloadSha256 || sha256hex(o.body || Buffer.alloc(0));

  // 组装要参与签名的头（小写名 -> 值），固定 host 与关键 x-amz/内容头
  const signed = {
    host: o.host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
    'content-type': o.headers['Content-Type'] || '',
  };
  if (o.sessionToken) signed['x-amz-security-token'] = o.sessionToken;
  // 按需加入其它头（保持值原样）
  for (const [k, v] of Object.entries(o.extraHeaders || {})) {
    if (v !== undefined && v !== null && v !== '') signed[k.toLowerCase()] = String(v);
  }

  const keys = Object.keys(signed).sort();
  const canonicalHeaders = keys.map((k) => `${k}:${signed[k]}\n`).join('');
  const signedHeaders = keys.join(';');

  const canonicalQuery = Object.keys(o.query || {})
    .sort()
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(o.query[k])}`)
    .join('&');

  const canonicalRequest = [
    o.method,
    o.path || '/',
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');

  const scope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = `AWS4-HMAC-SHA256\n${amzDate}\n${scope}\n${sha256hex(canonicalRequest)}`;

  const kDate = hmac(('AWS4' + o.secretKey), dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  const kSigning = hmac(kService, 'aws4_request');
  const signature = crypto.createHmac('sha256', kSigning).update(stringToSign).digest('hex');

  const authorization =
    `AWS4-HMAC-SHA256 Credential=${o.accessKey}/${scope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return {
    Authorization: authorization,
    'x-amz-date': amzDate,
    'x-amz-security-token': o.sessionToken || '',
    'x-amz-content-sha256': payloadHash,
  };
}

// 解析 Authorization（base64("50007225:<jwt>")）里 JWT 的 exp（秒级时间戳），解析失败返回 0
function authExpOf(auth) {
  try {
    const dec = Buffer.from(auth, 'base64').toString('utf8');
    const jwt = dec.includes(':') ? dec.split(':').slice(1).join(':') : dec;
    const payload = JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString('utf8'));
    return Number(payload.exp) || 0;
  } catch (e) {
    return 0;
  }
}

module.exports = {
  decryptVodToken,
  awsSigV4,
  authExpOf,
};
