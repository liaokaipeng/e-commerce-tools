'use strict';
// TikTok 下载模块常量与通用工具

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const REHYDRATION_MARKER = '<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application/json">';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 网络错误特征串（用于提示用户开启 VPN）
const NETWORK_PATTERNS = [
  'timeout', 'etimedout', 'econnreset', 'econnrefused', 'eai_again',
  'enetunreach', 'enotfound', 'getaddrinfo', 'socket hang up',
  'unable to connect', 'network is unreachable', 'tunnel', 'proxy',
  'certificate', 'self signed', 'tls', 'deadline exceeded',
];

module.exports = { UA, REHYDRATION_MARKER, sleep, NETWORK_PATTERNS };
