'use strict';
/**
 * 安装包下载：流式落盘并同步计算 sha256（大包不整块进内存）。
 * 使用 Node 内置 fetch，不新增运行时依赖。
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Readable, Transform } = require('stream');
const { pipeline } = require('stream/promises');

const { DOWNLOAD_TIMEOUT_MS } = require('./config');

/** 流式下载并同步计算 sha256（大包不整块进内存） */
async function downloadTo(url, dest, onProgress) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), DOWNLOAD_TIMEOUT_MS);
  try {
    const res = await fetch(url, { redirect: 'follow', signal: ctrl.signal });
    if (!res.ok) throw new Error(`下载失败：HTTP ${res.status}`);
    const total = Number(res.headers.get('content-length') || 0);
    const hash = crypto.createHash('sha256');
    let received = 0;
    const meter = new Transform({
      transform(chunk, _enc, cb) {
        hash.update(chunk);
        received += chunk.length;
        if (onProgress) onProgress(received, total);
        cb(null, chunk);
      },
    });
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    await pipeline(Readable.fromWeb(res.body), meter, fs.createWriteStream(dest));
    return { size: received, sha256: hash.digest('hex') };
  } catch (e) {
    if (e && e.name === 'AbortError') throw new Error('下载超时，请检查网络后重试');
    throw new Error((e && e.message) || String(e));
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { downloadTo };
