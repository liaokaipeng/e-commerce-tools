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
  return etagFromSha1Hex(crypto.createHash('sha1').update(buf).digest('hex'));
}

// 由 sha1 十六进制串构造上传 etag（S3 风格：0x16 前缀 + sha1，base64url）
function etagFromSha1Hex(sha1hex) {
  return Buffer.concat([Buffer.from([0x16]), Buffer.from(sha1hex, 'hex')]).toString('base64url');
}

/**
 * 流式计算文件哈希（md5 / sha1 / sha256）与大小，全程不整文件加载进内存。
 * 一次遍历同时产出 reportupload 需要的 md5、cn merge 需要的 etag（sha1）、ph SigV4 需要的 sha256。
 * @returns {Promise<{size, md5, sha1, sha256}>}
 */
function streamHashes(filePath) {
  return new Promise((resolve, reject) => {
    const md5 = crypto.createHash('md5');
    const sha1 = crypto.createHash('sha1');
    const sha256 = crypto.createHash('sha256');
    let size = 0;
    const rs = fs.createReadStream(filePath);
    rs.on('data', (c) => { size += c.length; md5.update(c); sha1.update(c); sha256.update(c); });
    rs.on('end', () => resolve({ size, md5: md5.digest('hex'), sha1: sha1.digest('hex'), sha256: sha256.digest('hex') }));
    rs.on('error', reject);
  });
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

// 在 buffer 的 [start, end) 范围顺序扫描，返回第一个 type 匹配的 box 位置 { body, end }，找不到返回 null
function findBox(buf, start, end, type) {
  let p = start;
  const e = end;
  while (p + 8 <= e) {
    let size = buf.readUInt32BE(p);
    const t = buf.toString('latin1', p + 4, p + 8);
    let body = p + 8;
    if (size === 1) { if (p + 16 > e) return null; size = Number(buf.readBigUInt64BE(p + 8)); body = p + 16; }
    else if (size === 0) { size = e - p; }
    if (size < 8 || p + size > e) return null;
    if (t === type) return { body, end: p + size };
    p += size;
  }
  return null;
}

// 解析 moov box（完整内容）里的 mvhd / tkhd，取宽高与时长；解析不出返回 0
function parseMoov(moov) {
  const r = { width: 0, height: 0, duration: 0 };
  let p = 0;
  while (p + 8 <= moov.length) {
    let size = moov.readUInt32BE(p);
    const type = moov.toString('latin1', p + 4, p + 8);
    let body = p + 8;
    if (size === 1) { if (p + 16 > moov.length) break; size = Number(moov.readBigUInt64BE(p + 8)); body = p + 16; }
    else if (size === 0) { size = moov.length - p; }
    if (size < 8 || p + size > moov.length) break;
    if (type === 'mvhd') {
      const ver = moov.readUInt8(body);
      let ts, dur;
      if (ver === 1) { ts = moov.readUInt32BE(body + 4 + 8 + 8); dur = Number(moov.readBigUInt64BE(body + 4 + 8 + 8 + 4)); }
      else { ts = moov.readUInt32BE(body + 4 + 4 + 4); dur = moov.readUInt32BE(body + 4 + 4 + 4 + 4); }
      if (ts > 0) r.duration = Math.round((dur / ts) * 1000);
    } else if (type === 'trak' && r.width === 0) {
      // tkhd 是 trak 的直接子 box，扫描一层即可
      const tEnd = p + size;
      let q = body;
      while (q + 8 <= tEnd) {
        let sz2 = moov.readUInt32BE(q);
        const t2 = moov.toString('latin1', q + 4, q + 8);
        let b2 = q + 8;
        if (sz2 === 1) { if (q + 16 > tEnd) break; sz2 = Number(moov.readBigUInt64BE(q + 8)); b2 = q + 16; }
        else if (sz2 === 0) { sz2 = tEnd - q; }
        if (sz2 < 8 || q + sz2 > tEnd) break;
        if (t2 === 'tkhd') {
          const ver = moov.readUInt8(b2);
          const off = ver === 1 ? b2 + 4 + 32 + 16 + 36 : b2 + 4 + 20 + 16 + 36;
          r.width = Math.round(moov.readUInt32BE(off) / 65536);
          r.height = Math.round(moov.readUInt32BE(off + 4) / 65536);
        }
        q += sz2;
      }
    }
    p += size;
  }
  return r;
}

/**
 * 从 MP4 buffer 解析宽高/时长（不依赖系统 ffprobe；解析失败返回全 0，不影响上传）。
 */
function probeVideo(buf) {
  const moov = findBox(buf, 0, buf.length, 'moov');
  return moov ? parseMoov(buf.subarray(moov.body, moov.end)) : { width: 0, height: 0, duration: 0 };
}

const PROBE_SAMPLE = 512 * 1024; // 头/尾采样窗口
const PROBE_MAX_MOOV = 8 * 1024 * 1024; // moov 超过该大小跳过探测（罕见，避免读大块）
const MOOV_SIG = Buffer.from('moov', 'latin1');

/**
 * 在尾部采样窗口内定位 moov box（非 faststart 布局：moov 在文件末尾）。
 * 窗口起点不保证与 box 边界对齐，不能像 findBox 那样按 box 头顺序解析，
 * 改为直接反向搜索 'moov' 签名，再由签名前 4 字节的 size 回推 box 起止。
 * 命中条件：size 合法且 box 不越界；优先取「恰好收尾」的那个（末尾布局最可靠），
 * 否则退回第一个合法的（容忍 moov 之后还有 free 等小 box）。
 * @param {Buffer} tail 尾部窗口内容
 * @param {number} tailStart 窗口在文件中的起始偏移
 * @param {number} fileSize 文件总大小
 * @returns {{body:number,end:number}|null}
 */
function findMoovInTail(tail, tailStart, fileSize) {
  let fallback = null;
  let idx = tail.lastIndexOf(MOOV_SIG);
  while (idx >= 4) {
    const boxStart = idx - 4;
    const size = tail.readUInt32BE(boxStart);
    const absStart = tailStart + boxStart;
    if (size >= 8 && size <= PROBE_MAX_MOOV && absStart + size <= fileSize) {
      const box = { body: absStart + 8, end: absStart + size };
      if (absStart + size === fileSize) return box;
      if (!fallback) fallback = box;
    }
    idx = tail.lastIndexOf(MOOV_SIG, idx - 1);
  }
  return fallback;
}

/**
 * 从 MP4 文件解析宽高/时长（不整文件加载）：采样文件头尾各 512KB 定位 moov，
 * 再按偏移只读 moov 完整内容解析。faststart 的 moov 在头部、非 faststart 的在尾部。
 */
function probeVideoFile(filePath) {
  const fd = fs.openSync(filePath, 'r');
  try {
    const size = fs.fstatSync(fd).size;
    if (size < 8) return { width: 0, height: 0, duration: 0 };
    const headLen = Math.min(PROBE_SAMPLE, size);
    const head = Buffer.alloc(headLen);
    fs.readSync(fd, head, 0, headLen, 0);
    let moov = findBox(head, 0, headLen, 'moov');
    if (!moov && size > PROBE_SAMPLE) {
      const tailLen = Math.min(PROBE_SAMPLE, size);
      const tail = Buffer.alloc(tailLen);
      fs.readSync(fd, tail, 0, tailLen, size - tailLen);
      moov = findMoovInTail(tail, size - tailLen, size);
    }
    if (!moov) return { width: 0, height: 0, duration: 0 };
    const moovSize = moov.end - moov.body;
    if (moovSize <= 0 || moovSize > PROBE_MAX_MOOV) return { width: 0, height: 0, duration: 0 };
    const moovBuf = Buffer.alloc(moovSize);
    fs.readSync(fd, moovBuf, 0, moovSize, moov.body);
    return parseMoov(moovBuf);
  } catch (e) { /* 解析失败保持 0，不影响上传 */ }
  finally { fs.closeSync(fd); }
  return { width: 0, height: 0, duration: 0 };
}

// 公共行校验（cn / ph 共用）；前端 video 页有同名的即时预览校验，文案/阈值需保持一致
const CAPTION_MAX_LENGTH = 250;
function validateUploadRow(row) {
  if (!row.path) return '缺少视频路径';
  if (row.caption && row.caption.length > CAPTION_MAX_LENGTH) return `视频说明超过${CAPTION_MAX_LENGTH}字符，请精简后再上传`;
  if (row.caption && /tiktok/i.test(row.caption)) return '视频说明不能包含 tiktok 字样';
  let st;
  try {
    st = fs.statSync(row.path);
  } catch (e) {
    return `表格中填写的视频文件不存在，请检查路径是否正确: ${row.path}`;
  }
  if (st.isDirectory()) return `表格中填写的是文件夹而不是视频文件，请检查路径: ${row.path}`;
  if (st.size === 0) return `视频文件内容为空（0 字节），请检查文件是否损坏: ${row.path}`;
  return '';
}

/** 构造「跳过该行不上传」的错误：processJob 捕获后会在 row-error 事件带 skip 标记，前端状态列显示「失败，商品为空」 */
function skipError(message) {
  const e = new Error(message);
  e.skip = true;
  return e;
}

module.exports = {
  md5hex,
  etagOf,
  etagFromSha1Hex,
  streamHashes,
  hmac,
  sha256hex,
  decryptVodToken,
  awsSigV4,
  authExpOf,
  findItemIds,
  probeVideo,
  probeVideoFile,
  findMoovInTail,
  validateUploadRow,
  skipError,
  CAPTION_MAX_LENGTH,
};