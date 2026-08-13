'use strict';
// 代理检测与 https agent 构造
const { execFileSync } = require('child_process');
const { HttpsProxyAgent } = require('https-proxy-agent');
const { SocksProxyAgent } = require('socks-proxy-agent');

/** 读取 Windows 系统代理（注册表） */
function getSystemProxyFromRegistry() {
  try {
    const out = execFileSync('reg', [
      'query',
      'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings',
      '/v', 'ProxyEnable',
    ], { encoding: 'utf8', windowsHide: true, timeout: 5000 });
    const enabled = /0x1\b/i.test(out);
    if (!enabled) return '';
    const serverOut = execFileSync('reg', [
      'query',
      'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings',
      '/v', 'ProxyServer',
    ], { encoding: 'utf8', windowsHide: true, timeout: 5000 });
    const m = serverOut.match(/ProxyServer\s+REG_SZ\s+(\S+)/i);
    if (!m) return '';
    const raw = m[1].trim();
    // 可能是 "http=127.0.0.1:7897;https=127.0.0.1:7897" 或 "127.0.0.1:7897"
    const perProto = raw.split(';').map(s => s.trim()).filter(Boolean);
    const httpPart = perProto.find(s => /^https?=/i.test(s));
    if (httpPart) return 'http://' + httpPart.split('=')[1];
    if (/^socks/i.test(raw)) return raw;
    return 'http://' + raw;
  } catch {
    return '';
  }
}

/** 检测可用的代理：环境变量优先，其次 Windows 系统代理 */
function detectProxy() {
  const envProxy = process.env.HTTPS_PROXY || process.env.https_proxy
    || process.env.HTTP_PROXY || process.env.http_proxy || '';
  if (envProxy) return envProxy;
  if (process.platform === 'win32') return getSystemProxyFromRegistry();
  return '';
}

/** 根据代理字符串创建 https agent */
function createAgent(proxy) {
  if (!proxy) return undefined;
  if (/^socks/i.test(proxy)) return new SocksProxyAgent(proxy);
  const p = /^https?:\/\//i.test(proxy) ? proxy : 'http://' + proxy;
  return new HttpsProxyAgent(p);
}

module.exports = { getSystemProxyFromRegistry, detectProxy, createAgent };
