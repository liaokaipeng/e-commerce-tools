'use strict';
const crypto = require('crypto');
const fs = require('fs');
const { call } = require('./request');
const { UA, SITES } = require('./constants');
const {
  streamHashes,
  decryptVodToken,
  awsSigV4,
  probeVideoFile,
  validateUploadRow,
} = require('../lib/video-utils');

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
  // 只打印非敏感的关键字段（vid / 域名 / 存储桶），凭证本身不入日志
  log('preupload', `vid=${vid} uploaddomain=${uploaddomain} bucket=${pre0.bucket || '(空)'} urlformat=${urlformat || '(空)'}`);
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

module.exports = { uploadOnePh };
