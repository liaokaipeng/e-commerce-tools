'use strict';
/**
 * Shopee 视频批量上传模块（CommonJS）
 * 由合并服务 main.js 引入，通过 register({ get, post }) 注册路由。
 * 接口流程：preupload -> 分片 upload -> mergeFiles -> reportupload -> item/list -> video/create
 * 凭证由浏览器扩展推送至 /api/creds，保存到本目录 video-session.json。
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { URL } = require('url');

const CHUNK_SIZE = 1 * 1024 * 1024; // 1MB 分片（与抓包一致）

const BIZ = 178;
const MMS = 'https://api.mms.shopee.cn';
const UPLOAD = 'https://up-sp.vod.shopee.cn';
const SOLUTIONS = 'https://solutions.shopee.cn';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36 Edg/150.0.0.0';

// ------- 简易 Cookie 罐（按 host 维护，分片上传会话依赖它） -------
const cookieJars = {}; // hostname -> {name: value}
function storeCookies(hostname, setCookieHeaders) {
  if (!setCookieHeaders) return;
  if (!cookieJars[hostname]) cookieJars[hostname] = {};
  for (const sc of setCookieHeaders) {
    const kv = sc.split(';')[0];
    const idx = kv.indexOf('=');
    if (idx > 0) cookieJars[hostname][kv.slice(0, idx).trim()] = kv.slice(idx + 1).trim();
  }
}
function getCookieHeader(hostname) {
  const j = cookieJars[hostname];
  if (!j || !Object.keys(j).length) return '';
  return Object.entries(j).map(([k, v]) => `${k}=${v}`).join('; ');
}

// ------- 自动凭证存储（浏览器扩展推送，网页读取） -------
const CREDS_FILE = path.join(__dirname, 'video-session.json');
let storedCreds = { auth: '', cookie: '', shopId: '', updatedAt: 0 };
try {
  if (fs.existsSync(CREDS_FILE)) {
    storedCreds = Object.assign(storedCreds, JSON.parse(fs.readFileSync(CREDS_FILE, 'utf8')));
  }
} catch (e) { /* ignore */ }
function saveCredsFile() {
  try { fs.writeFileSync(CREDS_FILE, JSON.stringify(storedCreds, null, 2)); } catch (e) { /* ignore */ }
}

// ------- 通用 HTTP 请求 -------
function request({ method = 'GET', url, headers = {}, body = null }) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const lib = u.protocol === 'https:' ? require('https') : require('http');
    const cookie = getCookieHeader(u.hostname);
    const reqHeaders = Object.assign({}, headers);
    if (cookie) reqHeaders['Cookie'] = cookie;
    if (body && reqHeaders['Content-Length'] === undefined && reqHeaders['content-length'] === undefined) {
      reqHeaders['Content-Length'] = Buffer.isBuffer(body) ? body.length : Buffer.byteLength(body);
    }

    const opts = {
      method,
      hostname: u.hostname,
      port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: u.pathname + u.search,
      headers: reqHeaders,
    };

    const req = lib.request(opts, (res) => {
      const chunks = [];
      res.on('data', (d) => chunks.push(d));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        if (res.headers['set-cookie']) storeCookies(u.hostname, res.headers['set-cookie']);
        const text = buf.toString('utf8');
        let json = null;
        try { json = JSON.parse(text); } catch (e) { /* not json */ }
        resolve({ status: res.statusCode, headers: res.headers, text, json, buf });
      });
    });
    req.on('error', reject);
    req.setTimeout(120000, () => req.destroy(new Error('请求超时')));
    if (body) req.write(body);
    req.end();
  });
}

// ------- 上传流程各步骤 -------
async function refreshAuthToken(cookie, shopId) {
  const resp = await request({
    method: 'GET',
    url: `${SOLUTIONS}/sellers/video-upload/api/v1/lib/authorization?shop_id=${encodeURIComponent(shopId)}`,
    headers: {
      accept: 'application/json, text/plain, */*',
      cookie,
      origin: 'https://solutions.shopee.cn',
      referer: 'https://solutions.shopee.cn/sellers/video-upload/',
      'user-agent': UA,
    },
  });
  const found = [];
  (function walk(v) {
    if (typeof v === 'string') {
      const m = v.match(/NTAw[A-Za-z0-9_\-=]{20,}/);
      if (m) found.push(m[0]);
    } else if (Array.isArray(v)) {
      v.forEach(walk);
    } else if (v && typeof v === 'object') {
      Object.values(v).forEach(walk);
    }
  })(resp.json || resp.text);
  if (!found.length) {
    const m = (typeof (resp.json || resp.text) === 'string' ? resp.text : JSON.stringify(resp.json))
      .match(/eyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}/);
    if (m) found.push('NTAwMDcyMjU6' + m[0]);
  }
  return { token: found[0] || '', resp };
}

function md5hex(buf) { return crypto.createHash('md5').update(buf).digest('hex'); }
function etagOf(buf) {
  const sha1 = crypto.createHash('sha1').update(buf).digest();
  return Buffer.concat([Buffer.from([0x16]), sha1]).toString('base64url');
}

async function preupload(auth) {
  const resp = await request({
    method: 'POST',
    url: `${MMS}/uploadapi/api/v1/vod/preupload`,
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/plain, */*',
      origin: 'https://solutions.shopee.cn',
      referer: 'https://solutions.shopee.cn/',
      'user-agent': UA,
    },
    body: JSON.stringify({
      biz: BIZ,
      ver: 2,
      mediatype: 1,
      reportdata: { sdkversion: '3.4.5', appversion: '3.4.5', ostype: 'web', reporttime: Date.now() },
    }),
  });
  return resp;
}

async function uploadChunk(chunk, etag, auth) {
  const resp = await request({
    method: 'POST',
    url: `${UPLOAD}/api/v2/upload/${BIZ}`,
    headers: {
      Authorization: auth,
      'Content-Type': 'application/octet-stream',
      ETag: etag,
      Origin: 'https://solutions.shopee.cn',
      Referer: 'https://solutions.shopee.cn/',
      'User-Agent': UA,
    },
    body: chunk,
  });
  return resp;
}

async function mergeFiles(fids, auth, fileEtag) {
  const resp = await request({
    method: 'POST',
    url: `${UPLOAD}/api/v2/mergeFiles/${BIZ}`,
    headers: {
      Authorization: auth,
      'Content-Type': 'video/mp4',
      ETag: fileEtag,
      Origin: 'https://solutions.shopee.cn',
      Referer: 'https://solutions.shopee.cn/',
      'User-Agent': UA,
    },
    body: JSON.stringify({ fids: fids.map((f, i) => ({ index: i, fid: f })) }),
  });
  return resp;
}

async function reportUpload({ vid, extendid, fsize, md5hexval, videourl }) {
  const resp = await request({
    method: 'POST',
    url: `${MMS}/uploadapi/api/v1/vod/reportupload`,
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/plain, */*',
      origin: 'https://solutions.shopee.cn',
      referer: 'https://solutions.shopee.cn/',
      'user-agent': UA,
    },
    body: JSON.stringify({
      vid,
      mid: '',
      serviceid: 'shopeeuss',
      biz: BIZ,
      region: 'CN',
      extendid,
      fsize,
      md5: md5hexval,
      videourl,
      code: 0,
      updomain: UPLOAD,
      reportdata: { cost: 0, sdkversion: '3.4.5', ostype: 'web', reporttime: Date.now() },
      fileinfos: { mediatype: 1 },
    }),
  });
  return resp;
}

async function itemList(keyword, cookie, shopId) {
  const url = `${SOLUTIONS}/sellers/video-upload/api/v1/item/list?shop_id=${shopId}&keyword=${encodeURIComponent(keyword)}&page_no=1&page_size=20`;
  const resp = await request({
    method: 'GET',
    url,
    headers: {
      accept: 'application/json, text/plain, */*',
      cookie,
      referer: 'https://solutions.shopee.cn/sellers/video-upload/',
      'user-agent': UA,
    },
  });
  return resp;
}

async function videoCreate({ cookie, shopId, vid, videourl, caption, itemId, videoSizeKB, width, height, duration }) {
  const resp = await request({
    method: 'POST',
    url: `${SOLUTIONS}/sellers/video-upload/api/v1/video/create`,
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/plain, */*',
      cookie,
      origin: 'https://solutions.shopee.cn',
      referer: 'https://solutions.shopee.cn/sellers/video-upload/',
      'user-agent': UA,
    },
    body: JSON.stringify({
      shop_id: Number(shopId),
      video: {
        width,
        height,
        video_size: videoSizeKB,
        url: videourl,
        duration,
        cover: '',
        video_file_id: vid,
      },
      caption: caption || '',
      items: itemId ? [{ item_id: Number(itemId) }] : [],
    }),
  });
  return resp;
}

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

// ------- 单个视频的完整上传 -------
async function uploadOne(row, creds, log) {
  let { auth, cookie, shopId } = creds;
  const filePath = row.path;
  if (!filePath) throw new Error('缺少视频路径');
  if (row.caption && row.caption.length > 250) throw new Error('视频说明超过250字符，请精简后再上传');
  if (row.caption && /tiktok/i.test(row.caption)) throw new Error('视频说明不能包含 tiktok 字样');
  if (!fs.existsSync(filePath)) throw new Error(`表格中填写的视频文件不存在，请检查路径是否正确: ${filePath}`);

  log('read', `读取文件: ${filePath}`);
  const fileBuf = fs.readFileSync(filePath);
  const fsize = fileBuf.length;
  const wholeMd5hex = md5hex(fileBuf);
  const wholeEtag = etagOf(fileBuf);
  const videoSizeKB = Math.round(fsize / 1024);

  if (cookie && shopId) {
    log('auth', '刷新上传凭证(token)...');
    try {
      const fr = await refreshAuthToken(cookie, shopId);
      if (fr.token) {
        auth = fr.token;
        storedCreds.auth = auth;
        storedCreds.updatedAt = Date.now();
        saveCredsFile();
        log('auth', `token 刷新成功: ${auth.slice(0, 26)}...`);
      } else {
        log('auth', `token 刷新失败(HTTP ${fr.resp.status})，回退使用现有 Authorization。响应: ${fr.resp.text.slice(0, 200)}`);
      }
    } catch (e) {
      log('auth', `token 刷新异常: ${e.message}，回退使用现有 Authorization`);
    }
  } else {
    log('auth', '缺少 Cookie/ShopId，无法自动刷新 token，使用现有 Authorization');
  }

  log('preupload', '申请上传...');
  const pre = await preupload(auth);
  const preData = (pre.json && (pre.json.data || pre.json)) || {};
  const vid = preData.vid;
  if (!vid) {
    throw new Error(`preupload 未返回 vid。响应: ${pre.text.slice(0, 500)}`);
  }
  const services = preData.services || [];
  const svc = services.find((s) => s.serviceid === 'shopeeuss') || services[0] || {};
  const downDomain = (svc.domain || '').replace(/\/+$/, '');
  const bucket = svc.bucket || String(BIZ);
  log('preupload', `vid=${vid} downDomain=${downDomain || '(空)'} bucket=${bucket}`);

  const totalChunks = Math.max(1, Math.ceil(fsize / CHUNK_SIZE));
  const fids = [];
  for (let i = 0; i < totalChunks; i++) {
    const start = i * CHUNK_SIZE;
    const chunk = fileBuf.subarray(start, Math.min(start + CHUNK_SIZE, fsize));
    const etag = etagOf(chunk);
    log('upload', `上传分片 ${i + 1}/${totalChunks} (${chunk.length} bytes, etag=${etag.slice(0, 8)}...)`);
    const up = await uploadChunk(chunk, etag, auth);
    const upData = (up.json && (up.json.data || up.json)) || {};
    const fid = upData.fid || upData.fileId || upData.id;
    if (!fid) {
      const tokenExpired = (up.json && up.json.code === 10003) || /token is expired/i.test(up.text);
      throw new Error(
        tokenExpired
          ? `上传凭证已过期（token is expired），自动刷新也未生效——很可能是 Cookie 已失效。请重新登录卖家中心，打开「短视频上传」页面手动上传一次视频，让扩展抓取最新 Cookie 后再试。原始响应: ${up.text.slice(0, 200)}`
          : `分片 ${i + 1} 上传未返回 fid。响应: ${up.text.slice(0, 500)}`
      );
    }
    fids.push(fid);
  }
  log('upload', `分片上传完成，共 ${fids.length} 片`);

  log('merge', '合并分片...');
  const merge = await mergeFiles(fids, auth, wholeEtag);
  const mergeData = (merge.json && (merge.json.data || merge.json)) || {};
  const mergeFid = mergeData.fid || mergeData.fileId || mergeData.id;
  if (!mergeFid) {
    throw new Error(`mergeFiles 未返回 fid。响应: ${merge.text.slice(0, 500)}`);
  }
  const extendid = mergeFid;
  let videourl = mergeData.videourl || mergeData.url || mergeData.videoUrl;
  if (!videourl) {
    if (!downDomain) throw new Error('preupload 未返回下载域名，无法拼接 videourl');
    videourl = `${downDomain}/${bucket}/${extendid}.mp4`;
  }
  log('merge', `fid=${mergeFid} videourl=${videourl}`);

  log('report', '上报上传结果...');
  const rep = await reportUpload({ vid, extendid: extendid || '', fsize, md5hexval: wholeMd5hex, videourl });
  log('report', `响应: ${rep.text.slice(0, 300)}`);

  let itemId = null;
  if (row.product) {
    log('item', `查询商品编码: ${row.product}`);
    const il = await itemList(row.product, cookie, shopId);
    const ids = findItemIds(il.json || {});
    if (ids.length) {
      itemId = ids[0];
      log('item', `匹配到 item_id=${itemId}`);
    } else {
      log('item', `未匹配到商品，响应: ${il.text.slice(0, 300)}`);
    }
  } else {
    log('item', '未提供商品编码，仅上传视频不关联商品');
  }

  log('create', '创建视频并发布...');
  const meta = probeVideo(fileBuf);
  log('create', `视频元信息: ${meta.width}x${meta.height}, ${meta.duration}ms`);
  const vc = await videoCreate({
    cookie,
    shopId,
    vid,
    videourl,
    caption: row.caption,
    itemId,
    videoSizeKB,
    width: meta.width,
    height: meta.height,
    duration: meta.duration,
  });
  if (vc.status !== 200 && vc.status !== 201) {
    throw new Error(`video/create 失败 (${vc.status}): ${vc.text.slice(0, 500)}`);
  }
  log('create', '发布成功');
  return { vid, videourl, itemId, response: vc.text.slice(0, 300) };
}

// ------- Job / SSE -------
const clients = new Map(); // jobId -> Set(res)

function broadcast(jobId, data) {
  const set = clients.get(jobId);
  if (!set) return;
  const payload = `data: ${JSON.stringify(data)}\n\n`;
  for (const res of set) res.write(payload);
}

async function processJob(jobId, rows, creds) {
  const total = rows.length;
  for (let i = 0; i < total; i++) {
    const row = rows[i];
    broadcast(jobId, { type: 'row-start', index: i, total, row });
    try {
      const result = await uploadOne(row, creds, (step, msg) =>
        broadcast(jobId, { type: 'step', index: i, step, msg })
      );
      broadcast(jobId, { type: 'row-done', index: i, result });
    } catch (e) {
      broadcast(jobId, { type: 'row-error', index: i, error: e.message });
    }
  }
  broadcast(jobId, { type: 'finished', total });
}

// ============ 路由注册 ============
function register({ get, post }) {
  get('/api/events', (req, res, url) => {
    const jobId = url.searchParams.get('jobId');
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });
    if (!clients.has(jobId)) clients.set(jobId, new Set());
    clients.get(jobId).add(res);
    res.write(`data: ${JSON.stringify({ type: 'connected' })}\n\n`);
    req.on('close', () => {
      const set = clients.get(jobId);
      if (set) set.delete(res);
    });
  });

  // 凭证：扩展推送（POST）/ 网页读取（GET）
  const corsH = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
  get('/api/creds', (req, res) => {
    res.writeHead(200, Object.assign({ 'Content-Type': 'application/json' }, corsH));
    res.end(JSON.stringify(storedCreds));
  });
  post('/api/creds', (req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      try {
        const p = JSON.parse(body);
        if (p.auth && p.auth.startsWith('NTAw')) storedCreds.auth = p.auth;
        if (p.cookie && p.cookie.length > 80) storedCreds.cookie = p.cookie;
        if (p.shopId) storedCreds.shopId = String(p.shopId);
        storedCreds.updatedAt = Date.now();
        saveCredsFile();
      } catch (e) { /* ignore */ }
      res.writeHead(200, Object.assign({ 'Content-Type': 'application/json' }, corsH));
      res.end(JSON.stringify({ ok: true, updatedAt: storedCreds.updatedAt }));
    });
  });

  post('/api/start', (req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      let parsed;
      try {
        parsed = JSON.parse(body);
      } catch (e) {
        res.writeHead(400); res.end('Invalid JSON'); return;
      }
      const { rows, auth, cookie, shopId } = parsed;
      if (!Array.isArray(rows) || !rows.length) {
        res.writeHead(400); res.end('缺少 rows'); return;
      }
      const jobId = crypto.randomBytes(8).toString('hex');
      clients.set(jobId, new Set());
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ jobId }));
      processJob(jobId, rows, { auth, cookie, shopId }).catch((e) =>
        broadcast(jobId, { type: 'fatal', error: e.message })
      );
    });
  });
}

module.exports = { register };