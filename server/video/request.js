'use strict';
const fs = require('fs');
const { request } = require('../lib/http');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 统一出站请求：视频上传各步骤依赖跨请求的会话 Cookie，故 useJar=true
// 对网络错误 / 超时 / 5xx 做指数退避重试；4xx 等业务错不重试（避免重复副作用）。
// opts.signal：任务取消时中断进行中的请求，且取消造成的中断不重试。
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

module.exports = { sleep, call, readChunk };
