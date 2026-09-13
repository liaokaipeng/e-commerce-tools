'use strict';
// TikTok 链接提取、视频解析（直连 + 第三方兜底）与文件下载（门面）
// 原先的多种职责已按单一职责拆分到 links / parse-page / third-party / download / errors，
// 本文件保留为门面，re-export 全部原有导出，调用方与测试的 require 路径不变。
const { extractUrls, extractVideoIdFromUrl } = require('./links');
const { parseViaPage } = require('./parse-page');
const { fetchViaThirdParty, parseVideo } = require('./third-party');
const { downloadFile } = require('./download');
const { isNetworkError } = require('./errors');

module.exports = {
  extractUrls,
  extractVideoIdFromUrl,
  parseViaPage,
  fetchViaThirdParty,
  parseVideo,
  downloadFile,
  isNetworkError,
};
