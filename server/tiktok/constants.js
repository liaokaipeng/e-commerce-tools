'use strict';
// TikTok 下载模块常量

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const REHYDRATION_MARKER = '<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application/json">';

// 跨视频请求间隔与随机抖动（毫秒）：降低被风控识别为批量脚本的概率
const REQUEST_DELAY_MS = 3000;
const REQUEST_DELAY_JITTER_MS = 1500;

// 网络错误特征串（用于提示用户开启 VPN）
const NETWORK_PATTERNS = [
  'timeout', 'etimedout', 'econnreset', 'econnrefused', 'eai_again',
  'enetunreach', 'enotfound', 'getaddrinfo', 'socket hang up',
  'unable to connect', 'network is unreachable', 'tunnel', 'proxy',
  'certificate', 'self signed', 'tls', 'deadline exceeded',
];

module.exports = { UA, REHYDRATION_MARKER, REQUEST_DELAY_MS, REQUEST_DELAY_JITTER_MS, NETWORK_PATTERNS };
