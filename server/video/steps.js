'use strict';
/**
 * 视频上传两站点（跨境 .cn / 本土 .ph）共用的上传步骤。
 *
 * 只收纳「两站点逐字等价」的步骤，站点真正的差异仍留在各自文件：
 *   - cn：分片 upload + mergeFiles + video/create（见 upload-cn.js）
 *   - ph：task/create + SigV4 单次 PUT + task/edit + task/post（见 upload-ph.js）
 * 站点不同的 preupload 请求头 / 报文体字段 / item/list 查询串与匹配规则，
 * 通过参数传入或保留在各自文件，本模块不替它们做主。
 */
const { call } = require('./request');
const { probeVideoFile, validateUploadRow, skipError } = require('../lib/video-utils');

// 行基础校验（路径/文件大小/caption 等），先于一切网络请求执行
function assertRowValid(row) {
  const rowErr = validateUploadRow(row);
  if (rowErr) throw new Error(rowErr);
}

// 商品前置校验①：未配置商品编码 → 直接跳过，不上传（前端状态列显示「失败，商品为空」）
function resolveProduct(row, log) {
  const product = String(row.product || '').trim();
  if (!product) {
    log('item', '未配置商品编码，跳过上传');
    throw skipError('未配置商品编码，已跳过上传');
  }
  return product;
}

// 纯数字的商品编码需做精确匹配，其余按名称模糊匹配
function isNumericCode(product) {
  return /^\d+$/.test(product);
}

// item/list 响应的 items（两站点结构一致）
function itemsOf(il) {
  return (il.json && il.json.data && il.json.data.items) || [];
}

// 登录态失效（302/HTML 登录页或网关错误页）是硬失败，不能当「商品不存在」跳过；
// 站点提示文案不同，由调用方以 makeMessage(il) 给出（逐字保留原文案）
function assertItemListOk(il, makeMessage) {
  if (il.status !== 200 || !il.json) throw new Error(makeMessage(il));
}

// 命中商品时的日志（文案两站点一致）
function logItemMatch(log, itemId) {
  log('item', `匹配到 item_id=${itemId}`);
}

// 商品前置校验②：配置了商品但查不到 → 跳过上传
function throwProductNotFound(product, log, text) {
  log('item', `未找到商品，响应: ${text.slice(0, 300)}`);
  throw skipError(`未找到商品编码 ${product} 对应的商品，已跳过上传`);
}

// preupload 返回体里挑出 shopeeuss 服务（无则退首个，再无则空对象）
function pickService(preData) {
  const services = preData.services || [];
  return services.find((s) => s.serviceid === 'shopeeuss') || services[0] || {};
}

// preupload 请求：MMS 域不带 Cookie（含 jar 罐，见各自文件注释），站点仅 url/headers/payload 不同
function preuploadRequest({ url, headers, payload, signal }) {
  return call({
    method: 'POST',
    url,
    signal,
    useJar: false,
    headers,
    body: JSON.stringify(payload),
  });
}

// reportupload 请求：写操作不重放（idempotent:false），MMS 域不带 Cookie
function reportuploadRequest({ url, headers, payload, signal }) {
  return call({
    method: 'POST',
    url,
    signal,
    idempotent: false,
    useJar: false,
    headers,
    body: JSON.stringify(payload),
  });
}

// 上报响应校验：HTTP 与业务码两段（报文逐字两站点一致，slice 长度均为 300）
function assertReportUpload(rep) {
  if (rep.status !== 200) {
    throw new Error(`reportupload 失败(HTTP ${rep.status})。响应: ${rep.text.slice(0, 300)}`);
  }
  if (rep.json && typeof rep.json.code === 'number' && rep.json.code !== 0) {
    throw new Error(`reportupload 业务失败(code=${rep.json.code})。响应: ${rep.text.slice(0, 300)}`);
  }
}

// 本地探测视频元信息并记录日志（step 名称两站点不同：cn=create / ph=edit）
function probeAndLog(filePath, step, log) {
  const meta = probeVideoFile(filePath);
  if (!meta.width || !meta.height || !meta.duration) log(step, '警告: 未能完整解析视频宽高/时长，将提交解析值');
  log(step, `视频元信息: ${meta.width}x${meta.height}, ${meta.duration}ms`);
  return meta;
}

module.exports = {
  assertRowValid,
  resolveProduct,
  isNumericCode,
  itemsOf,
  assertItemListOk,
  logItemMatch,
  throwProductNotFound,
  pickService,
  preuploadRequest,
  reportuploadRequest,
  assertReportUpload,
  probeAndLog,
};
