'use strict';
/**
 * 视频上传哈希 / etag 计算（无网络依赖，可独立单元测试）
 * 供上传链路（reportupload 的 md5、cn merge 的 etag、ph SigV4 的 sha256）与测试共用。
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

module.exports = {
  md5hex,
  etagOf,
  etagFromSha1Hex,
  streamHashes,
  hmac,
  sha256hex,
};
