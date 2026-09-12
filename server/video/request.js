'use strict';
const fs = require('fs');
const { request } = require('../lib/http');
const { retry, exponentialBackoff } = require('../lib/retry');

// 统一出站请求：视频上传各步骤依赖跨请求的会话 Cookie，故 useJar=true
// 对网络错误 / 超时 / 5xx 做指数退避重试；4xx 等业务错不重试（避免重复副作用）。
// opts.signal：任务取消时中断进行中的请求，且取消造成的中断不重试。
// opts.idempotent=false：非幂等写操作（mergeFiles / reportupload / video/create / ph 整文件 PUT——
//   body 是只读一次的文件流，重入会拿到已消费的流）。
//   这类请求服务端可能已处理、只是响应丢失，重放会造成重复合并 / 同一次上传发两条视频，
//   因此只在「连接根本没建立」类错误（DNS 失败、连接被拒、网络不可达）上重试。
// 退避与重试骨架见 lib/retry.js（与开放平台 / TikTok 解析等链路共用同一实现）。

// 可安全重试的连接类错误码：请求确定没到服务端
const SAFE_RETRY_CODES = new Set([
  'ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'ENETUNREACH', 'EHOSTUNREACH', 'ENETDOWN',
]);

/** 非幂等请求的唯一安全重试场景：连服务端都没连上 */
function isSafeToRetryNonIdempotent(err) {
  return !!(err && SAFE_RETRY_CODES.has(err.code));
}

async function call(opts) {
  const attempts = (opts && opts.retries != null ? opts.retries : 2) + 1;
  const idempotent = !(opts && opts.idempotent === false);
  const base = { useJar: true, timeout: 120000 };
  return retry(async () => {
    const resp = await request(Object.assign({}, base, opts));
    // 5xx 交给 retry 重试；4xx 直接返回给调用方判定业务语义
    if (resp.status >= 500 && resp.status < 600) throw new Error(`上游返回 HTTP ${resp.status}`);
    return resp;
  }, {
    attempts,
    waitOf: exponentialBackoff(1000, 8000),
    // 非幂等写操作：5xx 也不重试（服务端可能已写入），只重试连接未建立的错误
    shouldRetry: idempotent ? undefined : (e) => isSafeToRetryNonIdempotent(e),
    isAborted: () => !!(opts && opts.signal && opts.signal.aborted),
  });
}

// 按 [start, end) 读取文件的一段为 buffer（分片上传用，单片峰值 1MB，不整文件加载）
function readChunk(filePath, start, end) {
  // 空文件 / 越界分片：createReadStream({start:0,end:-1}) 会抛 ERR_OUT_OF_RANGE，
  // 用户只会看到 Node 底层报错。这里提前给出可读原因（正常路径已被 validateUploadRow 拦下）。
  if (!(end > start)) {
    return Promise.reject(new Error(`分片范围无效 [${start}, ${end})，文件可能为空: ${filePath}`));
  }
  return new Promise((resolve, reject) => {
    const chunks = [];
    const rs = fs.createReadStream(filePath, { start, end: end - 1 });
    rs.on('data', (c) => chunks.push(c));
    rs.on('end', () => resolve(Buffer.concat(chunks)));
    rs.on('error', reject);
  });
}

module.exports = { call, readChunk, _test: { isSafeToRetryNonIdempotent, SAFE_RETRY_CODES } };
