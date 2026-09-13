'use strict';
// 文件下载（自动跟随重定向，aweme 接口会 302 到实际 CDN 地址）
const fs = require('fs');
const https = require('https');
const { UA } = require('./constants');

/** 下载文件到指定路径（自动跟随重定向，aweme 接口会 302 到实际 CDN 地址） */
function downloadFile(url, destPath, cookies, agent, redirects = 5, signal) {
  return new Promise((resolve, reject) => {
    const out = fs.createWriteStream(destPath);
    // 立即挂载写流错误监听：文件创建失败（权限/磁盘满/被占用等）时 error 会异步立即触发，
    // 若等响应回调里才挂监听，就会变成未处理的 'error' 事件导致整个 node 进程崩溃（SSE 断流）。
    out.on('error', reject);
    // 清理半成品文件：中止或失败时移除 .part 残留
    const cleanup = () => {
      try { out.destroy(); } catch {}
      try { fs.rmSync(destPath, { force: true }); } catch {}
    };
    const req = https.request(url, {
      agent,
      headers: {
        'User-Agent': UA,
        'Accept': 'video/webm,video/mp4,video/*;q=0.9,*/*;q=0.8',
        'Referer': 'https://www.tiktok.com/',
        ...(cookies ? { 'Cookie': cookies } : {}),
      },
      timeout: 180000,
    }, (res) => {
      // 302 重定向：aweme/v1/play 接口返回 302 到实际 CDN 视频地址
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects > 0) {
        out.destroy();
        const next = new URL(res.headers.location, url).toString();
        res.resume();
        downloadFile(next, destPath, cookies, agent, redirects - 1, signal).then(resolve, reject);
        return;
      }
      if (res.statusCode !== 200) {
        cleanup();
        reject(new Error('视频下载返回 HTTP ' + res.statusCode));
        res.resume();
        return;
      }
      res.pipe(out);
      out.on('finish', () => resolve({ bytes: fs.statSync(destPath).size }));
    });
    const onAbort = () => { cleanup(); req.destroy(new Error('aborted')); };
    if (signal) {
      if (signal.aborted) onAbort();
      else signal.addEventListener('abort', onAbort, { once: true });
    }
    req.on('timeout', () => { cleanup(); req.destroy(new Error('timeout')); });
    req.on('error', reject);
    req.end();
  });
}

module.exports = { downloadFile };
