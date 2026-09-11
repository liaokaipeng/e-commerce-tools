'use strict';
const fs = require('fs');
const { request } = require('../lib/http');
const { retry, exponentialBackoff } = require('../lib/retry');

// 统一出站请求：视频上传各步骤依赖跨请求的会话 Cookie，故 useJar=true
// 对网络错误 / 超时 / 5xx 做指数退避重试；4xx 等业务错不重试（避免重复副作用）。
// opts.signal：任务取消时中断进行中的请求，且取消造成的中断不重试。
// 退避与重试骨架见 lib/retry.js（与开放平台 / TikTok 解析等链路共用同一实现）。
async function call(opts) {
  const attempts = (opts && opts.retries != null ? opts.retries : 2) + 1;
  const base = { useJar: true, timeout: 120000 };
  return retry(async () => {
    const resp = await request(Object.assign({}, base, opts));
    // 5xx 交给 retry 重试；4xx 直接返回给调用方判定业务语义
    if (resp.status >= 500 && resp.status < 600) throw new Error(`上游返回 HTTP ${resp.status}`);
    return resp;
  }, {
    attempts,
    waitOf: exponentialBackoff(1000, 8000),
    isAborted: () => !!(opts && opts.signal && opts.signal.aborted),
  });
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

module.exports = { call, readChunk };
