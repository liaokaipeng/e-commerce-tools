'use strict';
/**
 * 视频上传通用纯函数（无网络依赖，可独立单元测试）
 * 从 video.js 抽取：哈希 / 加密 / 签名 / MP4 探测 / 行校验等，供上传链路与测试共用。
 */
const crypto = require('crypto');
const fs = require('fs');

function md5hex(buf) {
  return crypto.createHash('md5').update(buf).digest('hex');
}

function etagOf(buf) {
  const sha1 = crypto.createHash('sha1').update(buf).digest();
  return Buffer.concat([Buffer.from([0x16]), sha1]).toString('base64url');
}

const hmac = (key, data) => crypto.createHmac('sha256', key).update(data).digest();
const sha256hex = (data) => crypto.createHash('sha256').update(data).digest('hex');

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
 * @param {object} o { method, host, path, query, headers, body, accessKey, secretKey, sessionToken, region, service }
 * @returns {object} 需要追加到请求里的签名头（Authorization / x-amz-date / x-amz-security-token / x-amz-content-sha256）
 */
function awsSigV4(o) {
  const now = new Date();
  const amzDate = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const dateStamp = amzDate.slice(0, 8);
  const region = o.region || 'us-east-1';
  const service = o.service || 's3';

  const payloadHash = sha256hex(o.body || Buffer.alloc(0));

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

// 深度遍历对象/数组，收集字段名匹配 /item_?id/i 的数值/字符串值
function findItemIds(obj, acc = []) {
  if (Array.isArray(obj)) {
    obj.forEach((o) => findItemIds(o, acc));
  } else if (obj && typeof obj === 'object') {
    for (const k of Object.keys(obj)) {
      if (/item_?id/i.test(k) && (typeof obj[k] === 'number' || typeof obj[k] === 'string')) {
        acc.push(obj[k]);
      } else {
        findItemIds(obj[k], acc);
      }
    }
  }
  return acc;
}

/**
 * 从 MP4 文件头解析宽高/时长（不加载完整文件）。
 * 纯解析本地 buffer，不依赖系统 ffprobe；解析失败返回全 0，不影响上传。
 */
function probeVideo(buf) {
  const r = { width: 0, height: 0, duration: 0 };
  function iter(start, end, cb) {
    let p = start;
    while (p + 8 <= end) {
      let size = buf.readUInt32BE(p);
      const type = buf.toString('latin1', p + 4, p + 8);
      let body = p + 8;
      if (size === 1) { if (p + 16 > end) break; size = Number(buf.readBigUInt64BE(p + 8)); body = p + 16; }
      else if (size === 0) { size = end - p; }
      if (size < 8 || p + size > end) break;
      cb(type, body, p + size);
      p += size;
    }
  }
  try {
    let moovB = -1, moovE = -1;
    iter(0, buf.length, (t, b, e) => { if (t === 'moov') { moovB = b; moovE = e; } });
    if (moovB < 0) return r;
    iter(moovB, moovE, (t, b, e) => {
      if (t === 'mvhd') {
        const ver = buf.readUInt8(b);
        let ts, dur;
        if (ver === 1) { ts = buf.readUInt32BE(b + 4 + 8 + 8); dur = Number(buf.readBigUInt64BE(b + 4 + 8 + 8 + 4)); }
        else { ts = buf.readUInt32BE(b + 4 + 4 + 4); dur = buf.readUInt32BE(b + 4 + 4 + 4 + 4); }
        if (ts > 0) r.duration = Math.round((dur / ts) * 1000);
      } else if (t === 'trak' && r.width === 0) {
        iter(b, e, (t2, b2) => {
          if (t2 === 'tkhd') {
            const ver = buf.readUInt8(b2);
            const off = ver === 1 ? b2 + 4 + 32 + 16 + 36 : b2 + 4 + 20 + 16 + 36;
            r.width = Math.round(buf.readUInt32BE(off) / 65536);
            r.height = Math.round(buf.readUInt32BE(off + 4) / 65536);
          }
        });
      }
    });
  } catch (e) { /* 解析失败则保持 0，不影响上传 */ }
  return r;
}

// 公共行校验（cn / ph 共用）
function validateUploadRow(row) {
  if (!row.path) return '缺少视频路径';
  if (row.caption && row.caption.length > 250) return '视频说明超过250字符，请精简后再上传';
  if (row.caption && /tiktok/i.test(row.caption)) return '视频说明不能包含 tiktok 字样';
  if (!fs.existsSync(row.path)) return `表格中填写的视频文件不存在，请检查路径是否正确: ${row.path}`;
  return '';
}

module.exports = {
  md5hex,
  etagOf,
  hmac,
  sha256hex,
  decryptVodToken,
  awsSigV4,
  authExpOf,
  findItemIds,
  probeVideo,
  validateUploadRow,
};