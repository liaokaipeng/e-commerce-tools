'use strict';
const { call, readChunk } = require('./request');
const { CHUNK_SIZE, BIZ, MMS, UPLOAD, SOLUTIONS, UA, CN } = require('./constants');
const { resolveCnAuth } = require('./creds');
const {
  etagOf,
  etagFromSha1Hex,
  streamHashes,
  findItemIds,
  probeVideoFile,
  validateUploadRow,
} = require('../lib/video-utils');

// ------- 跨境 .cn 上传流程各步骤 -------
async function preupload(signal) {
  const resp = await call({
    method: 'POST',
    url: `${MMS}/uploadapi/api/v1/vod/preupload`,
    signal,
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/plain, */*',
      origin: SOLUTIONS,
      referer: `${SOLUTIONS}/`,
      'user-agent': UA,
    },
    body: JSON.stringify({
      biz: BIZ,
      ver: 2,
      mediatype: 1,
      reportdata: { sdkversion: CN.sdkversion, appversion: CN.appversion, ostype: CN.ostype, reporttime: Date.now() },
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
      Origin: SOLUTIONS,
      Referer: `${SOLUTIONS}/`,
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
    // 写操作：响应丢失后重放会重复合并，只允许「连接未建立」类错误重试
    idempotent: false,
    headers: {
      Authorization: auth,
      'Content-Type': 'video/mp4',
      ETag: fileEtag,
      Origin: SOLUTIONS,
      Referer: `${SOLUTIONS}/`,
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
    idempotent: false, // 写操作：不重放（详见 request.js call 的说明）
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/plain, */*',
      origin: SOLUTIONS,
      referer: `${SOLUTIONS}/`,
      'user-agent': UA,
    },
    body: JSON.stringify({
      vid,
      mid: '',
      serviceid: CN.serviceid,
      biz: BIZ,
      region: CN.region,
      extendid,
      fsize,
      md5: md5hexval,
      videourl,
      code: 0,
      updomain: UPLOAD,
      reportdata: { cost: 0, sdkversion: CN.sdkversion, ostype: CN.ostype, reporttime: Date.now() },
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
      referer: `${SOLUTIONS}/sellers/video-upload/`,
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
    // 写操作：重放会在同一次点击里发出两条视频，绝不重试 5xx/超时
    idempotent: false,
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/plain, */*',
      cookie,
      origin: SOLUTIONS,
      referer: `${SOLUTIONS}/sellers/video-upload/`,
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

  // 前端已按所选店铺断言凭证，这里兜底：缺 shopId 会让 video/create 提交 Number(undefined)=NaN
  if (!shopId) {
    throw new Error('缺少店铺 ID（shopId），跨境上传需先选择要发布视频的店铺，请在大厅选择店铺后重试。');
  }
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
  // 响应不是 JSON（如网关返回 200 + HTML 错误页）时无法确认发布结果，按失败处理，
  // 否则 createCode=null 会绕过下方业务码校验，被误判为「发布成功」
  if (!vc.json) {
    throw new Error(`video/create 返回非 JSON 响应 (${vc.status})，无法确认发布结果: ${vc.text.slice(0, 500)}`);
  }
  const createCode = vc.json.errorCode ?? vc.json.code;
  const postId = (vc.json && vc.json.data && (vc.json.data.post_id ?? vc.json.data.postId)) || null;
  // solutions 接口成功码为 200000（msg="成功"，返回 post_id）；旧版接口可能用 0。有 post_id 即视为发布成功
  if (createCode != null && createCode !== 0 && createCode !== 200000 && !postId) {
    throw new Error(`video/create 业务失败 (errorCode=${createCode}): ${vc.text.slice(0, 500)}`);
  }
  log('create', `发布成功${postId ? `（post_id=${postId}）` : ''}`);
  return { vid, videourl, itemId, postId, response: vc.text.slice(0, 300) };
}

module.exports = { uploadOneCn };
