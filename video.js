'use strict';
/**
 * Shopee 视频批量上传模块（CommonJS）
 * 由合并服务 main.js 引入，通过 register({ get, post }) 注册路由。
 * 接口流程：preupload -> 分片 upload -> mergeFiles -> reportupload -> item/list -> video/create
 * 凭证由浏览器扩展推送至 /api/creds，保存到本目录 video-session.json。
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { request } = require('./lib/http');
const {
  etagOf,
  etagFromSha1Hex,
  streamHashes,
  decryptVodToken,
  awsSigV4,
  authExpOf,
  findItemIds,
  probeVideoFile,
  validateUploadRow,
} = require('./lib/video-utils');

const CHUNK_SIZE = 1 * 1024 * 1024; // 1MB 分片（与抓包一致）

const BIZ = 178;
const MMS = 'https://api.mms.shopee.cn';
const UPLOAD = 'https://up-sp.vod.shopee.cn';
const SOLUTIONS = 'https://solutions.shopee.cn';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36 Edg/150.0.0.0';

// ------- 站点配置（跨境 / 本土） -------
// cn = 跨境（.cn 覆盖多国）；ph = 本土菲律宾（一个站点一个域名）。
// 上传链路不同：cn 走分片+merge（域名/参数见顶部常量），ph 走单次 PUT+task 发布（域名/参数见此处配置）。
const SITES = {
  cn: { label: '跨境（.cn）' },
  ph: {
    label: '本土-菲律宾（.ph）',
    mms: 'https://api.mms.shopee.ph',
    creator: 'https://creator.shopee.ph',
    origin: 'https://seller.shopee.ph',
    biz: 201,
    region: 'PH',
    ostype: '2',
    sdkversion: 'mms-3.6.0',
  },
};

// ------- 自动凭证存储（浏览器扩展推送，网页读取） -------
// 出站请求统一走 lib/http 的 request（useJar=true 由 lib 内部按 host 维护分片会话 Cookie 罐）。
// 跨境 cn 支持多店铺：storedCreds.cn = { shops: { [shopId]: { auth, cookie, userid, updatedAt } } }
// 本土 ph 保持单店铺：storedCreds.ph = { auth, cookie, shopId, userid, updatedAt }
const CREDS_FILE = path.join(__dirname, 'video-session.json');
let storedCreds = {}; // site -> creds

// 旧扁平凭证格式 {auth,cookie,shopId,userid,updatedAt} → 统一结构（字段缺省为空）
function flatCreds(o) {
  return {
    auth: o.auth || '',
    cookie: o.cookie || '',
    shopId: o.shopId || '',
    userid: o.userid || '',
    updatedAt: o.updatedAt || 0,
  };
}

// 从扩展推送的原始对象中提取可存凭证（auth 需为合法 token 前缀、cookie 需足够长，避免存垃圾值）
function credsPatch(src, withShopId) {
  const patch = {};
  if (src.auth && src.auth.startsWith('NTAw')) patch.auth = src.auth;
  if (src.cookie && src.cookie.length > 80) patch.cookie = src.cookie;
  if (withShopId && src.shopId) patch.shopId = String(src.shopId);
  if (src.userid) patch.userid = String(src.userid);
  return patch;
}

function loadCredsFile() {
  let raw = {};
  try {
    if (fs.existsSync(CREDS_FILE)) raw = JSON.parse(fs.readFileSync(CREDS_FILE, 'utf8'));
  } catch (e) {
    console.warn('读取视频凭证文件失败:', e.message);
    return;
  }
  // 兼容旧格式：顶层 {auth,cookie,shopId} 视为跨境 cn → 归入 shops
  if (raw.auth || raw.cookie || raw.shopId) {
    const flat = flatCreds(raw);
    if (flat.shopId) storedCreds.cn = { shops: { [String(flat.shopId)]: flat } };
  }
  for (const s of Object.keys(SITES)) {
    const v = raw[s];
    if (!v || typeof v !== 'object') continue;
    if (s === 'cn') {
      if (v.shops && typeof v.shops === 'object') storedCreds.cn = { shops: v.shops };
      else if (v.cookie || v.auth || v.shopId) {
        const flat = flatCreds(v);
        if (flat.shopId) storedCreds.cn = { shops: { [String(flat.shopId)]: flat } };
      }
    } else if (v.cookie || v.auth || v.shopId || v.userid) {
      storedCreds[s] = v;
    }
  }
}
function saveCredsFile() {
  try { fs.writeFileSync(CREDS_FILE, JSON.stringify(storedCreds, null, 2)); }
  catch (e) { console.warn('保存视频凭证文件失败:', e.message); }
}
function getCreds(site) {
  return storedCreds[site] || { auth: '', cookie: '', shopId: '', userid: '' };
}
function setCredsFor(site, patch) {
  storedCreds[site] = Object.assign(getCreds(site), patch, { updatedAt: Date.now() });
  saveCredsFile();
}
// 跨境 cn 多店铺存取
function cnShops() {
  return (storedCreds.cn && storedCreds.cn.shops) || {};
}
function getCnShop(shopId) {
  return cnShops()[String(shopId)] || { auth: '', cookie: '', userid: '' };
}
function setCnShop(shopId, patch) {
  const id = String(shopId);
  const shops = cnShops();
  shops[id] = Object.assign(getCnShop(id), patch, { updatedAt: Date.now() });
  storedCreds.cn = Object.assign(storedCreds.cn || {}, { shops });
  saveCredsFile();
}
loadCredsFile();

// 统一出站请求：视频上传各步骤依赖跨请求的会话 Cookie，故 useJar=true
// 对网络错误 / 超时 / 5xx 做指数退避重试；4xx 等业务错不重试（避免重复副作用）。
// opts.signal：任务取消时中断进行中的请求，且取消造成的中断不重试。
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function call(opts) {
  const maxAttempts = (opts && opts.retries != null ? opts.retries : 2) + 1;
  const base = { useJar: true, timeout: 120000 };
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const resp = await request(Object.assign({}, base, opts));
      if (resp.status >= 500 && resp.status < 600 && attempt < maxAttempts) {
        await sleep(Math.min(1000 * Math.pow(2, attempt - 1), 8000));
        continue;
      }
      return resp;
    } catch (e) {
      // 任务取消（signal.aborted）直接抛出，不重试、不混淆为行失败
      if (opts.signal && opts.signal.aborted) throw e;
      if (attempt < maxAttempts) {
        await sleep(Math.min(1000 * Math.pow(2, attempt - 1), 8000));
        continue;
      }
      throw e;
    }
  }
  throw new Error('请求重试后仍失败');
}

// 按 [start, end) 读取文件的一段为 buffer（分片上传用，单片峰值 1MB，不整文件加载）
function readChunk(filePath, start, end) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const rs = fs.createReadStream(filePath, { start, end: end - 1 });
    rs.on('data', (c) => chunks.push(c));
    rs.on('end', () => resolve(Buffer.concat(chunks)));
    rs.on('error', reject);
  });
}

// ------- 上传流程各步骤 -------
// 用 Cookie 尝试从授权接口换取新上传凭证，换到返回 token，换不到返回空字符串。
// 注意：部分账号类型的授权接口不返回可换取的凭证，此时依赖扩展在手动上传时抓取的凭证（账号级通用）。
async function refreshAuthToken(cookie, shopId, signal) {
  const resp = await call({
    method: 'GET',
    url: `${SOLUTIONS}/sellers/video-upload/api/v1/lib/authorization?shop_id=${encodeURIComponent(shopId)}`,
    signal,
    headers: {
      accept: 'application/json, text/plain, */*',
      cookie,
      origin: 'https://solutions.shopee.cn',
      referer: 'https://solutions.shopee.cn/sellers/video-upload/',
      'user-agent': UA,
    },
  });
  // 优先直接匹配响应文本中的 VOD token（形如 NTAw...），其次兜底 JWT 前缀拼接
  const text = typeof resp.text === 'string' ? resp.text : JSON.stringify(resp.json);
  const m = text.match(/NTAw[A-Za-z0-9_\-=]{20,}/);
  if (m) return m[0];
  const jwt = text.match(/eyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}/);
  return jwt ? 'NTAwMDcyMjU6' + jwt[0] : '';
}

// 解析 Authorization（base64("50007225:<jwt>")）里 JWT 的 exp（秒级时间戳），解析失败返回 0
// （实现见 lib/video-utils.js 的 authExpOf）

// 跨境凭证统一解析（唯一入口），优先级：本地已抓凭证（账号级通用，取有效期最长的）→ Cookie 换取 → 报错引导手动上传
async function resolveCnAuth(creds, log, signal) {
  const nowSec = Date.now() / 1000;
  const candidates = [];
  if (creds.auth) candidates.push({ from: '当前所选', auth: creds.auth });
  for (const [id, s] of Object.entries(cnShops())) {
    if (s && s.auth) candidates.push({ from: `店铺 ${id}`, auth: s.auth });
  }
  candidates.sort((a, b) => authExpOf(b.auth) - authExpOf(a.auth));
  const best = candidates.find((c) => authExpOf(c.auth) > nowSec + 60);
  if (best) {
    const exp = authExpOf(best.auth);
    log('auth', `使用已抓取的上传凭证（${best.from}，到期 ${new Date(exp * 1000).toLocaleString('zh-CN', { hour12: false })}）`);
    return best.auth;
  }
  if (creds.cookie && creds.shopId) {
    log('auth', '本地无有效凭证，尝试用 Cookie 换取新凭证...');
    try {
      const token = await refreshAuthToken(creds.cookie, creds.shopId, signal);
      if (token) {
        setCnShop(creds.shopId, { auth: token });
        log('auth', '凭证换取成功');
        return token;
      }
    } catch (e) {
      log('auth', `凭证换取异常: ${e.message}`);
    }
  }
  throw new Error('无可用上传凭证（Authorization 缺失或已过期）。请登录卖家中心，在任一跨境店铺的「短视频上传」页面手动上传一次视频，扩展抓到凭证后，同账号下所有店铺（含不同国家站点）均可直接批量上传。');
}

// ------- 公共行校验（cn / ph 共用，实现见 lib/video-utils.js 的 validateUploadRow） -------
async function preupload(signal) {
  const resp = await call({
    method: 'POST',
    url: `${MMS}/uploadapi/api/v1/vod/preupload`,
    signal,
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

async function uploadChunk(chunk, etag, auth, signal) {
  const resp = await call({
    method: 'POST',
    url: `${UPLOAD}/api/v2/upload/${BIZ}`,
    signal,
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

async function mergeFiles(fids, auth, fileEtag, signal) {
  const resp = await call({
    method: 'POST',
    url: `${UPLOAD}/api/v2/mergeFiles/${BIZ}`,
    signal,
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

async function reportUpload({ vid, extendid, fsize, md5hexval, videourl }, signal) {
  const resp = await call({
    method: 'POST',
    url: `${MMS}/uploadapi/api/v1/vod/reportupload`,
    signal,
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

async function itemList(keyword, cookie, shopId, signal) {
  const url = `${SOLUTIONS}/sellers/video-upload/api/v1/item/list?shop_id=${shopId}&keyword=${encodeURIComponent(keyword)}&page_no=1&page_size=20`;
  const resp = await call({
    method: 'GET',
    url,
    signal,
    headers: {
      accept: 'application/json, text/plain, */*',
      cookie,
      referer: 'https://solutions.shopee.cn/sellers/video-upload/',
      'user-agent': UA,
    },
  });
  return resp;
}

async function videoCreate({ cookie, shopId, vid, videourl, caption, itemId, videoSizeKB, width, height, duration }, signal) {
  const resp = await call({
    method: 'POST',
    url: `${SOLUTIONS}/sellers/video-upload/api/v1/video/create`,
    signal,
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

// item 匹配辅助与视频元信息探测实现见 lib/video-utils.js（findItemIds / probeVideoFile）

// ------- 单个视频的完整上传（跨境 .cn） -------
async function uploadOneCn(row, creds, log, signal) {
  let { auth, cookie, shopId } = creds;
  const filePath = row.path;
  const rowErr = validateUploadRow(row);
  if (rowErr) throw new Error(rowErr);

  log('read', `读取文件: ${filePath}`);
  const hashes = await streamHashes(filePath);
  const fsize = hashes.size;
  const wholeMd5hex = hashes.md5;
  const wholeEtag = etagFromSha1Hex(hashes.sha1);
  const videoSizeKB = Math.round(fsize / 1024);

  // 凭证统一由 resolveCnAuth 解析：优先本地已抓凭证中有效期最长的（账号级通用）→ 兜底 Cookie 换取 → 报错引导手动上传
  auth = await resolveCnAuth({ auth, cookie, shopId }, log, signal);

  log('preupload', '申请上传...');
  const pre = await preupload(signal);
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
    const end = Math.min(start + CHUNK_SIZE, fsize);
    const chunk = await readChunk(filePath, start, end);
    const etag = etagOf(chunk);
    log('upload', `上传分片 ${i + 1}/${totalChunks} (${chunk.length} bytes, etag=${etag.slice(0, 8)}...)`);
    const up = await uploadChunk(chunk, etag, auth, signal);
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
  const merge = await mergeFiles(fids, auth, wholeEtag, signal);
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
  const rep = await reportUpload({ vid, extendid: extendid || '', fsize, md5hexval: wholeMd5hex, videourl }, signal);
  log('report', `响应: ${rep.text.slice(0, 300)}`);

  let itemId = null;
  if (row.product) {
    log('item', `查询商品编码: ${row.product}`);
    const isCode = /^\d+$/.test(String(row.product).trim());
    const il = await itemList(row.product, cookie, shopId, signal);
    const items = (il.json && il.json.data && il.json.data.items) || [];
    const hit = isCode
      ? items.find((it) => String(it.item_id ?? it.itemId) === String(row.product).trim())
      : items[0];
    if (hit) {
      itemId = hit.item_id ?? hit.itemId;
      log('item', `匹配到 item_id=${itemId}`);
    } else {
      const ids = findItemIds(il.json || {});
      if (ids.length) {
        itemId = ids[0];
        log('item', `匹配到 item_id=${itemId}（模糊）`);
      } else {
        log('item', `未匹配到商品，响应: ${il.text.slice(0, 300)}`);
      }
    }
  } else {
    log('item', '未提供商品编码，仅上传视频不关联商品');
  }

  log('create', '创建视频并发布...');
  const meta = probeVideoFile(filePath);
  if (!meta.width || !meta.height || !meta.duration) log('create', '警告: 未能完整解析视频宽高/时长，将提交解析值');
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
  }, signal);
  if (vc.status !== 200 && vc.status !== 201) {
    throw new Error(`video/create 失败 (${vc.status}): ${vc.text.slice(0, 500)}`);
  }
  const createCode = vc.json ? (vc.json.errorCode ?? vc.json.code) : null;
  const postId = (vc.json && vc.json.data && (vc.json.data.post_id ?? vc.json.data.postId)) || null;
  // solutions 接口成功码为 200000（msg="成功"，返回 post_id）；旧版接口可能用 0。有 post_id 即视为发布成功
  if (createCode != null && createCode !== 0 && createCode !== 200000 && !postId) {
    throw new Error(`video/create 业务失败 (errorCode=${createCode}): ${vc.text.slice(0, 500)}`);
  }
  log('create', `发布成功${postId ? `（post_id=${postId}）` : ''}`);
  return { vid, videourl, itemId, postId, response: vc.text.slice(0, 300) };
}

// ------- 单个视频的完整上传（本土菲律宾 .ph） -------
// 链路：task/create -> vod/preupload -> 单次 PUT 整文件 -> vod/reportupload
//       -> item/list 查商品 -> task/edit 写标题/商品 -> task/post 发布
// 与跨境不同：无分片/merge，无 solutions 域名，biz=201，region=PH。
async function uploadOnePh(row, creds, site, log, signal) {
  const S = SITES[site];
  const cookie = creds.cookie || '';
  const filePath = row.path;
  const rowErr = validateUploadRow(row);
  if (rowErr) throw new Error(rowErr);

  // MMS 上传接口（preupload/reportupload）不带 Cookie：带上会返回跨区 uploaddomain 导致 400
  const mmsH = {
    'content-type': 'application/json',
    accept: 'application/json, text/plain, */*',
    origin: S.origin,
    referer: S.origin + '/',
    'user-agent': UA,
  };
  // creator.shopee.ph 业务接口（task/create、item/list、task/edit、task/post）带 Cookie
  const jsonH = Object.assign({ cookie }, mmsH);

  log('read', `读取文件: ${filePath}`);
  const hashes = await streamHashes(filePath);
  const fsize = hashes.size;
  const wholeMd5hex = hashes.md5;
  const payloadSha256 = hashes.sha256;

  // 1. task/create 创建发布任务
  log('task', '创建发布任务(task/create)...');
  const tc = await call({ method: 'POST', url: `${S.creator}/publish/pc/api/task/create`, headers: jsonH, body: '{}', signal });
  const tcData = (tc.json && tc.json.data) || {};
  const taskId = tcData.taskId;
  if (!taskId) throw new Error(`task/create 未返回 taskId。响应: ${tc.text.slice(0, 300)}`);

  // 2. vod/preupload 申请上传，拿 vid / uploaddomain / token
  log('preupload', '申请上传(vod/preupload)...');
  const preResp = await call({
    method: 'POST',
    url: `${S.mms}/uploadapi/api/v1/vod/preupload`,
    signal,
    headers: Object.assign({ 'content-type': 'application/json;charset=UTF-8' }, mmsH),
    body: JSON.stringify({
      biz: S.biz,
      ver: 2,
      mediatype: 1,
      reportdata: { sdkversion: S.sdkversion, appversion: S.sdkversion, ostype: S.ostype, userid: creds.userid || '', reporttime: Date.now() },
    }),
  });
  const preData = (preResp.json && preResp.json.data) || {};
  const pre0 = (preData.services || []).find((s) => s.serviceid === 'shopeeuss') || preData.services[0] || {};
  const vid = preData.vid;
  // access_key / token 均为 AES 加密，需按前端 SDK 逻辑解密后使用
  const accessKey = pre0.access_key ? decryptVodToken(pre0.access_key, S.biz) : '';
  const token = pre0.token ? decryptVodToken(pre0.token, S.biz) : '';
  const uploaddomain = (pre0.uploaddomain || '').replace(/\/+$/, '');
  const urlformat = pre0.urlformat || '';
  const secretKey = pre0.secret_key || '';
  if (!vid || !accessKey || !secretKey || !token || !uploaddomain) {
    throw new Error(`preupload 未返回完整凭证(vid/access_key/secret_key/token/uploaddomain)。响应: ${preResp.text.slice(0, 500)}`);
  }
  // 调试：打印 preupload 返回的关键字段（凭证截断），便于核对
  const pre0Debug = Object.assign({}, pre0, { token: token.slice(0, 20) + '...', access_key: accessKey.slice(0, 20) + '...' });
  log('preupload', `vid=${vid} uploaddomain=${uploaddomain} urlformat=${urlformat || '(空)'} pre0=${JSON.stringify(pre0Debug)}`);

  // 3. 单次 PUT 上传整个文件（S3/COS 风格，AWS SigV4 签名）
  // 对象键：urlformat 是下载 CDN 地址（含 api/v4/xxx/mms 路由前缀），不是存储键；
  // 需用 preupload 返回的 bucket + keyformat 拼出真实对象键（如 /mms/{vid}.mp4）。
  const uploadUrl = urlformat ? urlformat.replace('{vid}', vid).replace('{extend}', 'mp4') : '';
  const fileKey = vid + '.mp4';
  const bucket = (pre0.bucket || '').replace(/^\/+/, '').replace(/\/+$/, '');
  const objectKey = bucket ? `/${bucket}/${fileKey}` : `/${fileKey}`;
  const upUrl = new URL(uploaddomain);
  const upHost = upUrl.hostname;
  log('upload', `上传文件到 ${uploaddomain}${objectKey}?x-id=PutObject (urlformat=${uploadUrl}) ...`);

  // S3 临时凭证映射（与前端 MMS SDK 一致，已用浏览器抓包 1:1 回放验证）：
  // AccessKeyId = 解密后的 access_key（形如 tk...，网关从中解析 appInfo）；
  // SecretAccessKey = secret_key（明文 UUID）。直接用原始加密 token 当 AccessKeyId
  // 会导致网关解析不出 appInfo，报 403 InvalidAccessKeyId: appInfo Not exist。
  const metaHeaders = {
    'x-amz-meta-mms-hasattach': 'false',
    'x-amz-meta-mms-mediaid': vid,
    'amz-sdk-request': 'attempt=1; max=3',
    'amz-sdk-invocation-id': crypto.randomUUID(),
  };
  const sigHeaders = awsSigV4({
    method: 'PUT',
    host: upHost,
    path: objectKey,
    query: { 'x-id': 'PutObject' },
    headers: { 'Content-Type': 'video/mp4' },
    extraHeaders: metaHeaders,
    payloadSha256,
    accessKey,
    secretKey,
    sessionToken: '',
    region: S.region,
    service: 's3',
  });

  const putResp = await call({
    method: 'PUT',
    url: `${uploaddomain}${objectKey}?x-id=PutObject`,
    timeout: 300000,
    signal,
    headers: Object.assign(
      {
        'Content-Type': 'video/mp4',
        Authorization: sigHeaders.Authorization,
        'x-amz-date': sigHeaders['x-amz-date'],
        'x-amz-content-sha256': sigHeaders['x-amz-content-sha256'],
        Origin: S.origin,
        Referer: S.origin + '/',
        'User-Agent': UA,
      },
      sigHeaders['x-amz-security-token'] ? { 'x-amz-security-token': sigHeaders['x-amz-security-token'] } : {},
      metaHeaders
    ),
    // 流式上传：body 为读流，不整文件加载进内存（sha256 已通过 payloadSha256 预计算）
    body: fs.createReadStream(filePath, { highWaterMark: 4 * 1024 * 1024 }),
  });
  if (putResp.status !== 200 && putResp.status !== 201) {
    throw new Error(`文件上传失败(HTTP ${putResp.status})。响应: ${putResp.text.slice(0, 300)}`);
  }
  log('upload', `上传完成，${fsize} bytes`);

  // 4. vod/reportupload 上报
  const extendid = vid;
  const videourl = uploadUrl;
  log('report', '上报上传结果(vod/reportupload)...');
  const repResp = await call({
    method: 'POST',
    url: `${S.mms}/uploadapi/api/v1/vod/reportupload`,
    signal,
    headers: mmsH,
    body: JSON.stringify({
      vid,
      mid: '',
      serviceid: 'shopeeuss',
      updomain: uploaddomain,
      biz: S.biz,
      region: S.region,
      extendid,
      fsize,
      md5: wholeMd5hex,
      videourl,
      code: 0,
      reportdata: { cost: 0, sdkversion: S.sdkversion, ostype: S.ostype, reporttime: Date.now(), userid: creds.userid || '' },
      fileinfos: { mediatype: 1 },
    }),
  });
  log('report', `响应: ${repResp.text.slice(0, 200)}`);

  // 5. item/list 查商品（可选关联）
  let itemId = null;
  let productItem = null;
  if (row.product) {
    log('item', `查询商品编码: ${row.product}`);
    // itemName 只按商品名称模糊匹配；纯数字的商品编码需走 itemId 参数精确查询
    const isCode = /^\d+$/.test(String(row.product).trim());
    const qs = isCode
      ? `page=1&pageSize=10&itemId=${encodeURIComponent(String(row.product).trim())}`
      : `page=1&pageSize=10&itemName=${encodeURIComponent(row.product)}`;
    const il = await call({
      method: 'GET',
      url: `${S.creator}/publish/pc/api/item/list?${qs}`,
      headers: jsonH,
      signal,
    });
    const items = (il.json && il.json.data && il.json.data.items) || [];
    const hit = isCode ? items.find((it) => String(it.itemId) === String(row.product).trim()) : items[0];
    if (hit) {
      itemId = hit.itemId;
      productItem = hit;
      log('item', `匹配到 item_id=${itemId}`);
    } else {
      log('item', `未匹配到商品，响应: ${il.text.slice(0, 300)}`);
    }
  } else {
    log('item', '未提供商品编码，仅上传视频不关联商品');
  }

  // 6. 本地探测视频元信息
  const meta = probeVideoFile(filePath);
  if (!meta.width || !meta.height || !meta.duration) log('edit', '警告: 未能完整解析视频宽高/时长，将提交解析值');
  log('edit', `视频元信息: ${meta.width}x${meta.height}, ${meta.duration}ms`);

  // 7. task/edit 写入标题/商品/元信息
  const editBody = {
    taskList: [{
      taskId,
      mmsVid: vid,
      allowInfo: { allowDuet: true, allowStitch: true },
      coverFrameTime: 0,
      cover: '',
      caption: row.caption || '',
      productList: productItem ? [productItem] : [],
      scheduledInfo: { scheduledPost: false },
      duration: meta.duration,
      width: meta.width,
      height: meta.height,
    }],
  };
  log('edit', '写入标题/商品/信息(task/edit)...');
  const editResp = await call({ method: 'POST', url: `${S.creator}/publish/pc/api/task/edit`, headers: jsonH, body: JSON.stringify(editBody), signal });
  const editTask = ((editResp.json && editResp.json.data && editResp.json.data.taskList) || [])[0] || {};
  if (editResp.status !== 200 || editTask.errorCode !== 0) {
    throw new Error(`task/edit 失败(${editResp.status})。响应: ${editResp.text.slice(0, 500)}`);
  }
  log('edit', '写入成功');

  // 8. task/post 发布
  log('post', '发布(task/post)...');
  const postResp = await call({ method: 'POST', url: `${S.creator}/publish/pc/api/task/post`, headers: jsonH, body: JSON.stringify({ taskIdList: [taskId] }), signal });
  const postTask = ((postResp.json && postResp.json.data && postResp.json.data.taskList) || [])[0] || {};
  if (postResp.status !== 200 || postTask.errorCode !== 0) {
    throw new Error(`task/post 失败(${postResp.status})。响应: ${postResp.text.slice(0, 500)}`);
  }
  log('post', '发布成功');
  return { vid, taskId, itemId, response: postResp.text.slice(0, 300) };
}

// ------- Job / SSE -------
const clients = new Map(); // jobId -> Set(res)
// jobId -> [event, ...]：任务已产生的事件，供“迟到连接”回放。
// 任务可能在 SSE 连接建立前就结束（如首行校验秒失败），没有回放会让前端一直卡在“上传中”。
const jobEvents = new Map();
const JOB_EVENT_CAP = 20; // 本地工具场景，最多缓存最近 20 个任务的事件
const JOB_EVENT_MAX = 200; // 单个任务最多保留 200 条事件

// 任务取消：jobControllers（jobId -> AbortController，中断进行中的请求）+ abortedJobs（取消标志）
const jobControllers = new Map();
const abortedJobs = new Set();

function keepJobEvents(jobId, data) {
  if (!jobEvents.has(jobId)) jobEvents.set(jobId, []);
  const arr = jobEvents.get(jobId);
  arr.push(data);
  if (arr.length > JOB_EVENT_MAX) arr.splice(0, arr.length - JOB_EVENT_MAX);
  if (jobEvents.size > JOB_EVENT_CAP) {
    const first = jobEvents.keys().next().value;
    jobEvents.delete(first);
  }
}

function broadcast(jobId, data) {
  keepJobEvents(jobId, data);
  const set = clients.get(jobId);
  if (!set) return;
  const payload = `data: ${JSON.stringify(data)}\n\n`;
  for (const res of set) {
    // 连接可能已关闭，避免 write 抛错被误记为上传失败
    try { if (!res.writableEnded) res.write(payload); } catch (e) { /* 忽略写错误 */ }
  }
}

// 任务收尾：中断请求、清取消标志、断开 SSE 连接（clients 由各连接 close 自行清理，这里兜底）
function finishJob(jobId) {
  const c = jobControllers.get(jobId);
  if (c) { try { c.abort(); } catch (e) { /* ignore */ } jobControllers.delete(jobId); }
  abortedJobs.delete(jobId);
  clients.delete(jobId);
}

async function processJob(jobId, rows, creds, uploadOne) {
  const total = rows.length;
  let done = 0;
  for (let i = 0; i < total; i++) {
    if (abortedJobs.has(jobId)) {
      broadcast(jobId, { type: 'cancelled', total, done });
      finishJob(jobId);
      return;
    }
    const row = rows[i];
    broadcast(jobId, { type: 'row-start', index: i, total, row });
    try {
      const signal = (jobControllers.get(jobId) || { signal: undefined }).signal;
      const result = await uploadOne(row, creds, (step, msg) =>
        broadcast(jobId, { type: 'step', index: i, step, msg })
      , signal);
      done++;
      broadcast(jobId, { type: 'row-done', index: i, result });
    } catch (e) {
      // 取消触发的中断（如正在上传的请求被 abort）不当作行失败上报
      if (abortedJobs.has(jobId)) {
        broadcast(jobId, { type: 'cancelled', total, done });
        finishJob(jobId);
        return;
      }
      done++;
      broadcast(jobId, { type: 'row-error', index: i, error: e.message });
    }
  }
  broadcast(jobId, { type: 'finished', total, done });
  finishJob(jobId);
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
    res.write(`data: ${JSON.stringify({ type: 'connected' })}\n\n`);
    // 迟到连接：任务已产生过事件（可能已结束）则回放，若已 finished 直接关闭
    const past = jobEvents.get(jobId) || [];
    for (const ev of past) {
      if (res.writableEnded) break;
      res.write(`data: ${JSON.stringify(ev)}\n\n`);
    }
    if (past.length && past[past.length - 1].type === 'finished') {
      res.end();
      return;
    }
    if (!clients.has(jobId)) clients.set(jobId, new Set());
    clients.get(jobId).add(res);
    req.on('close', () => {
      const set = clients.get(jobId);
      if (set) {
        set.delete(res);
        if (!set.size) clients.delete(jobId);
      }
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
    // 返回全部站点的凭证，由前端按所选站点取用
    res.end(JSON.stringify({ sites: storedCreds, updatedAt: Date.now() }));
  });

  post('/api/creds', (req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      try {
        const p = JSON.parse(body);
        // 扩展单条推送：{ site, auth, cookie, shopId, userid }
        if (p.site && SITES[p.site]) {
          if (p.site === 'cn' && p.shopId) setCnShop(p.shopId, credsPatch(p, false));
          else setCredsFor(p.site, credsPatch(p, true));
        }
        // 扩展批量推送：{ sites: { cn: { shops: {...} }, ph: {...} } }
        if (p.sites && typeof p.sites === 'object') {
          for (const [s, v] of Object.entries(p.sites)) {
            if (!SITES[s] || !v || typeof v !== 'object') continue;
            if (s === 'cn') {
              if (v.shops && typeof v.shops === 'object') {
                for (const [shopId, sv] of Object.entries(v.shops)) {
                  if (!sv || typeof sv !== 'object') continue;
                  setCnShop(shopId, credsPatch(sv, false));
                }
              } else if (v.shopId) {
                // 兼容旧扁平批量格式：{ cn: { auth, cookie, shopId, userid } } → 归入该店铺
                setCnShop(v.shopId, credsPatch(v, false));
              }
            } else {
              setCredsFor(s, credsPatch(v, true));
            }
          }
        }
      } catch (e) { /* ignore */ }
      res.writeHead(200, Object.assign({ 'Content-Type': 'application/json' }, corsH));
      res.end(JSON.stringify({ ok: true, updatedAt: Date.now() }));
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
      const { site = 'cn', rows, auth, cookie, shopId, userid } = parsed;
      const siteKey = SITES[site] ? site : 'cn';
      if (!Array.isArray(rows) || !rows.length) {
        res.writeHead(400); res.end('缺少 rows'); return;
      }
      // 优先用前端传入的凭证，其次用本机已存储的该站点凭证。
      // 跨境 cn 支持多店铺：按 shopId 取对应店铺存根。
      let creds;
      if (siteKey === 'cn' && shopId) {
        const shop = getCnShop(shopId);
        creds = {
          auth: auth || shop.auth,
          cookie: cookie || shop.cookie,
          shopId: String(shopId),
          userid: userid || shop.userid || '',
        };
      } else {
        creds = {
          auth: auth || getCreds(siteKey).auth,
          cookie: cookie || getCreds(siteKey).cookie,
          shopId: shopId || getCreds(siteKey).shopId,
          userid: userid || getCreds(siteKey).userid || '',
        };
      }
      const jobId = crypto.randomBytes(8).toString('hex');
      clients.set(jobId, new Set());
      jobControllers.set(jobId, new AbortController());
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ jobId }));
      const uploadOne = siteKey === 'ph'
        ? (row, creds, log, signal) => uploadOnePh(row, creds, siteKey, log, signal)
        : (row, creds, log, signal) => uploadOneCn(row, creds, log, signal);
      processJob(jobId, rows, creds, uploadOne).catch((e) =>
        broadcast(jobId, { type: 'fatal', error: e.message })
      );
    });
  });

  // 取消任务：标记取消并中断进行中的请求；processJob 见取消标志后广播 cancelled 并收尾
  post('/api/cancel', (req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      let jobId = '';
      try { jobId = String((JSON.parse(body) || {}).jobId || ''); } catch (e) { jobId = ''; }
      if (!jobId) {
        res.writeHead(400); res.end(JSON.stringify({ ok: false, message: '缺少 jobId' })); return;
      }
      if (!jobControllers.has(jobId)) {
        res.writeHead(404); res.end(JSON.stringify({ ok: false, message: '任务不存在或已结束' })); return;
      }
      abortedJobs.add(jobId);
      const c = jobControllers.get(jobId);
      if (c) c.abort();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    });
  });
}

module.exports = { register };

// 仅供单元测试使用的内部状态与任务调度（无需启动服务即可确定性验证取消逻辑）
module.exports._test = {
  processJob,
  jobEvents,
  broadcast,
  abortedJobs,
  jobControllers,
  finishJob,
};