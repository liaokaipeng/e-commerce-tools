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
  skipError,
} = require('../lib/video-utils');

// ------- 单个视频的完整上传（本土菲律宾 .ph） -------
// 链路：item/list 查商品（前置校验） -> task/create -> vod/preupload -> 单次 PUT 整文件
//       -> vod/reportupload -> task/edit 写标题/商品 -> task/post 发布
// 与跨境不同：无分片/merge，无 solutions 域名，biz=201，region=PH。
async function uploadOnePh(row, creds, site, log, signal) {
  const S = SITES[site];
  const cookie = creds.cookie || '';
  const filePath = row.path;
  const rowErr = validateUploadRow(row);
  if (rowErr) throw new Error(rowErr);

  // 商品前置校验①：未配置商品编码 → 直接跳过，不上传（前端状态列显示「失败，商品为空」）
  const product = String(row.product || '').trim();
  if (!product) {
    log('item', '未配置商品编码，跳过上传');
    throw skipError('未配置商品编码，已跳过上传');
  }

  // MMS 上传接口（preupload/reportupload）不带 Cookie：带上会返回跨区 uploaddomain 导致 400。
  // 且必须 useJar:false——请求不显式带 Cookie 时，Cookie 罐里该 host 的残留 set-cookie 会被
  // 「jar 补齐」逻辑整条带上，同样触发 400（表现为间歇性，preupload 响应下发过 cookie 即发作）
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

  // 商品前置校验②：配置了商品但查不到 → 跳过上传（原逻辑在上传完成后才查询，现提前到上传前，避免白传大文件）
  let itemId = null;
  let productItem = null;
  log('item', `查询商品编码: ${product}`);
  // itemName 只按商品名称模糊匹配；纯数字的商品编码需走 itemId 参数精确查询
  const isCode = /^\d+$/.test(product);
  const qs = isCode
    ? `page=1&pageSize=10&itemId=${encodeURIComponent(product)}`
    : `page=1&pageSize=10&itemName=${encodeURIComponent(product)}`;
  const il = await call({
    method: 'GET',
    url: `${S.creator}/publish/pc/api/item/list?${qs}`,
    headers: jsonH,
    signal,
  });
  // Cookie 失效时 creator 常返回 302/HTML 登录页（或网关错误页），items 为空——
  // 若不区分会误报「商品不存在」跳过上传；登录态问题是硬失败，不能当 skip 处理
  if (il.status !== 200 || !il.json) {
    throw new Error(`商品查询失败(HTTP ${il.status})，很可能是 creator 登录态已失效。请重新登录 creator.shopee.ph 后让扩展重新抓取 Cookie 再试。响应: ${il.text.slice(0, 200)}`);
  }
  const items = (il.json && il.json.data && il.json.data.items) || [];
  const hit = isCode ? items.find((it) => String(it.itemId) === product) : items[0];
  if (hit) {
    itemId = hit.itemId;
    productItem = hit;
    log('item', `匹配到 item_id=${itemId}`);
  } else {
    log('item', `未找到商品，响应: ${il.text.slice(0, 300)}`);
    throw skipError(`未找到商品编码 ${product} 对应的商品，已跳过上传`);
  }

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
    useJar: false, // MMS 接口不带 Cookie（含 jar 罐，见 mmsH 注释）
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
    // body 是只读一次的文件流：retry 重入会拿到已消费/已销毁的同一个流，传出 0 字节或坏数据。
    // PUT 对固定对象键在服务端是幂等的，但请求体不可重放，故按非幂等处理——
    // 只在「连接未建立」类错误（流尚未被消费）时重试，5xx/超时一律失败让用户重跑该行
    idempotent: false,
    // 超时按文件大小缩放（约 100KB/s 下限，如 100MB ≈ 17 分钟），固定 300s 对大文件慢网必超时
    timeout: Math.max(300000, Math.ceil(fsize / 100)),
    signal,
    useJar: false, // 上传域用 SigV4 鉴权，不带 Cookie（含 jar 罐）
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
    idempotent: false, // 写操作：不重放（详见 request.js call 的说明）
    useJar: false, // MMS 接口不带 Cookie（含 jar 罐，见 mmsH 注释）
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
  // 上报失败若继续 task/edit/post，后续报错（视频不存在等）会掩盖真实原因，这里先校验
  if (repResp.status !== 200) {
    throw new Error(`reportupload 失败(HTTP ${repResp.status})。响应: ${repResp.text.slice(0, 300)}`);
  }
  if (repResp.json && typeof repResp.json.code === 'number' && repResp.json.code !== 0) {
    throw new Error(`reportupload 业务失败(code=${repResp.json.code})。响应: ${repResp.text.slice(0, 300)}`);
  }

  // 5. 本地探测视频元信息
  const meta = probeVideoFile(filePath);
  if (!meta.width || !meta.height || !meta.duration) log('edit', '警告: 未能完整解析视频宽高/时长，将提交解析值');
  log('edit', `视频元信息: ${meta.width}x${meta.height}, ${meta.duration}ms`);

  // 6. task/edit 写入标题/商品/元信息
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
  const postResp = await call({ method: 'POST', url: `${S.creator}/publish/pc/api/task/post`, headers: jsonH, body: JSON.stringify({ taskIdList: [taskId] }), signal, idempotent: false });
  const postTask = ((postResp.json && postResp.json.data && postResp.json.data.taskList) || [])[0] || {};
  if (postResp.status !== 200 || postTask.errorCode !== 0) {
    throw new Error(`task/post 失败(${postResp.status})。响应: ${postResp.text.slice(0, 500)}`);
  }
  log('post', '发布成功');
  return { vid, taskId, itemId, response: postResp.text.slice(0, 300) };
}

module.exports = { uploadOnePh };
