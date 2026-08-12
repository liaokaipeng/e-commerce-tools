// 统一出站 HTTP 请求封装（http/https）
// 供 bidding.js / video.js 共用，替代各自实现的 fetch / request。
// - useJar=true 时按 host 维护 Cookie 罐（视频分片上传多会话依赖）
// - 否则由调用方通过 headers 显式传入 Cookie
'use strict';
const http = require('http');
const https = require('https');
const { URL } = require('url');

const cookieJars = {}; // hostname -> { name: value }

function storeCookies(hostname, setCookieHeaders) {
  if (!setCookieHeaders) return;
  if (!cookieJars[hostname]) cookieJars[hostname] = {};
  for (const sc of setCookieHeaders) {
    const kv = sc.split(';')[0];
    const idx = kv.indexOf('=');
    if (idx > 0) cookieJars[hostname][kv.slice(0, idx).trim()] = kv.slice(idx + 1).trim();
  }
}

function getCookieHeader(hostname) {
  const j = cookieJars[hostname];
  if (!j || !Object.keys(j).length) return '';
  return Object.entries(j).map(([k, v]) => `${k}=${v}`).join('; ');
}

/**
 * 发送请求
 * @param {object} opts { method, url, headers, body, useJar, timeout }
 * @returns {Promise<{status, headers, text, json, buf}>}
 */
function request({ method = 'GET', url, headers = {}, body = null, useJar = false, timeout = 120000 }) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const lib = u.protocol === 'https:' ? https : http;
    const reqHeaders = Object.assign({}, headers);
    if (useJar) {
      const cookie = getCookieHeader(u.hostname);
      if (cookie && reqHeaders['Cookie'] === undefined) reqHeaders['Cookie'] = cookie;
    }
    if (body && reqHeaders['Content-Length'] === undefined && reqHeaders['content-length'] === undefined) {
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
    if (body) req.write(body);
    req.end();
  });
}

module.exports = { request };