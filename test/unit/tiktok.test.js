'use strict';
// 单元测试：TikTok 链接处理、错误分类、代理检测与构造。
const { t } = require('../helpers');
const { extractUrls, extractVideoIdFromUrl, isNetworkError } = require('../../server/tiktok/parse');
const { detectProxy, createAgent } = require('../../server/tiktok/proxy');

async function run() {
  // ===== TikTok 链接处理 =====
  t('extractUrls 只识别有效 tiktok 链接', extractUrls('https://www.tiktok.com/@a/video/123\nhttp://vm.tiktok.com/abc\n不是链接').length === 2);
  t('extractUrls 空输入返回空数组', extractUrls('').length === 0);
  t('extractVideoIdFromUrl 提取数字 id', extractVideoIdFromUrl('https://www.tiktok.com/@a/video/1234567890?x=1') === '1234567890');
  t('extractVideoIdFromUrl 短链接返回空串', extractVideoIdFromUrl('http://vm.tiktok.com/abc') === '');

  // ===== 错误分类 =====
  t('isNetworkError 识别网络错误', isNetworkError(new Error('getaddrinfo ENOTFOUND tiktok.com')) === true);
  t('isNetworkError 业务错误不误报', isNetworkError(new Error('视频不存在或已被删除')) === false);

  // ===== 代理检测与构造 =====
  {
    const old = process.env.HTTPS_PROXY;
    process.env.HTTPS_PROXY = 'http://127.0.0.1:7890';
    try {
      t('detectProxy 优先读环境变量', detectProxy() === 'http://127.0.0.1:7890');
    } finally {
      if (old === undefined) delete process.env.HTTPS_PROXY;
      else process.env.HTTPS_PROXY = old;
    }
    t('createAgent 空代理返回 undefined', createAgent('') === undefined);
    t('createAgent socks 代理', createAgent('socks5://127.0.0.1:1080').constructor.name === 'SocksProxyAgent');
    t('createAgent http 代理', createAgent('127.0.0.1:7890').constructor.name === 'HttpsProxyAgent');
  }
}

module.exports = { run };
