// 统一出站 HTTP 请求封装（http/https）
// 供 bidding.js / video.js 共用，替代各自实现的 fetch / request。
// - useJar=true 时按 host 维护 Cookie 罐（视频分片上传多会话依赖）
// - 否则由调用方通过 headers 显式传入 Cookie
'use strict';
const http = require('http');
const https = require('https');
const { URL } = require('url');

const cookieJars = {}; // hostname -> { jar: {name:value}, at: 最后写入时间 }

// Cookie 罐空闲回收：本服务是单机长跑进程，若只写不删，各站点 Cookie 会一直堆积
// （切站点/换账号时旧罐也不再有用）。超过 TTL 未更新的罐整体丢弃——罐内是短期会话
// Cookie（如视频上传的 vod 凭证），过期后本来也需要重新获取。
const JAR_TTL_MS = 6 * 60 * 60 * 1000; // 6 小时
const JAR_SWEEP_MS = 30 * 60 * 1000;   // 30 分钟巡检一次

function sweepJars(now = Date.now()) {
  for (const host of Object.keys(cookieJars)) {
    if (now - cookieJars[host].at > JAR_TTL_MS) delete cookieJars[host];
  }
}

// 巡检定时器不阻止进程退出
const jarTimer = setInterval(() => sweepJars(), JAR_SWEEP_MS);
if (jarTimer.unref) jarTimer.unref();

function storeCookies(hostname, setCookieHeaders) {
  if (!setCookieHeaders) return;
  sweepJars();
  let entry = cookieJars[hostname];
  if (!entry) entry = cookieJars[hostname] = { jar: {}, at: 0 };
  for (const sc of setCookieHeaders) {
    const kv = sc.split(';')[0];
    const idx = kv.indexOf('=');
    if (idx > 0) entry.jar[kv.slice(0, idx).trim()] = kv.slice(idx + 1).trim();
  }
  entry.at = Date.now();
}

function getCookieHeader(hostname) {
  const entry = cookieJars[hostname];
  if (!entry) return '';
  const names = Object.keys(entry.jar);
  if (!names.length) return '';
  return names.map((k) => `${k}=${entry.jar[k]}`).join('; ');
}

/**
 * 发送请求
 * @param {object} opts { method, url, headers, body, useJar, timeout, signal }
 *   body 支持 Buffer / string / ReadableStream（大文件流式上传，不整文件加载进内存）
 *   signal 传入 AbortSignal，abort 时中断请求（任务取消用）
 * @returns {Promise<{status, headers, text, json, buf}>}
 */
function request({ method = 'GET', url, headers = {}, body = null, useJar = false, timeout = 120000, signal }) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const lib = u.protocol === 'https:' ? https : http;
    const isStream = body && typeof body.pipe === 'function' && typeof body.on === 'function';
    const reqHeaders = Object.assign({}, headers);
    if (useJar) {
      const cookie = getCookieHeader(u.hostname);
      if (cookie && reqHeaders['Cookie'] === undefined) reqHeaders['Cookie'] = cookie;
    }
    if (body && !isStream && reqHeaders['Content-Length'] === undefined && reqHeaders['content-length'] === undefined) {
      reqHeaders['Content-Length'] = Buffer.isBuffer(body) ? body.length : Buffer.byteLength(body);
    }

    const opts = {
      method,
      hostname: u.hostname,
      port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: u.pathname + u.search,
      headers: reqHeaders,
    };

    const req = lib.request(opts, (res) => {
      const chunks = [];
      res.on('data', (d) => chunks.push(d));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        if (useJar && res.headers['set-cookie']) storeCookies(u.hostname, res.headers['set-cookie']);
        const text = buf.toString('utf8');
        let json = null;
        try { json = JSON.parse(text); } catch (e) { /* not json */ }
        resolve({ status: res.statusCode, headers: res.headers, text, json, buf });
      });
    });
    req.on('error', reject);
    req.setTimeout(timeout, () => req.destroy(new Error('请求超时')));
    if (signal) {
      if (signal.aborted) { req.destroy(new Error('已取消')); return; }
      signal.addEventListener('abort', () => req.destroy(new Error('已取消')), { once: true });
    }
    if (isStream) {
      // 流式 body：pipe 会自动在流结束时 end 请求
      body.pipe(req);
    } else {
      if (body) req.write(body);
      req.end();
    }
  });
}

module.exports = { request, _test: { cookieJars, sweepJars, JAR_TTL_MS } };