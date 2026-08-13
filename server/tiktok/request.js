'use strict';
// 出站 HTTPS 请求（含重定向跟随与 AbortSignal 中断）
const https = require('https');

function httpsGet(url, { agent, headers = {}, method = 'GET', timeout = 30000, redirects = 5, signal } = {}) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, { agent, headers, method, timeout }, (res) => {
      // 重定向处理
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects > 0) {
        res.resume();
        const nextUrl = new URL(res.headers.location, url).toString();
        httpsGet(nextUrl, { agent, headers, method, timeout, redirects: redirects - 1, signal })
          .then(resolve, reject);
        return;
      }
      const cookies = (res.headers['set-cookie'] || []).map(c => c.split(';')[0]).join('; ');
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (c) => data += c);
      res.on('end', () => resolve({ status: res.statusCode, body: data, cookies }));
    });
    const onAbort = () => req.destroy(new Error('aborted'));
    if (signal) {
      if (signal.aborted) onAbort();
      else signal.addEventListener('abort', onAbort, { once: true });
    }
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.end();
  });
}

module.exports = { httpsGet };
