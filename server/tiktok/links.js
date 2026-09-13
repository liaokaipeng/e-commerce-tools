'use strict';
// TikTok 链接处理：从文本中提取有效链接、从链接提取 video id

/** 从文本中提取有效的 TikTok 视频链接 */
function extractUrls(text) {
  const urls = [];
  for (const line of text.split(/\r?\n/)) {
    const u = line.trim();
    if (!u) continue;
    if (/^https?:\/\/(www\.|vm\.|vt\.)?tiktok\.com\//i.test(u) || /^https?:\/\/v\.tiktok\.com\//i.test(u)) {
      urls.push(u);
    }
  }
  return urls;
}

/** 提取 video id（用于确认与命名） */
function extractVideoIdFromUrl(url) {
  const m = url.match(/\/video\/(\d+)/);
  return m ? m[1] : '';
}

module.exports = { extractUrls, extractVideoIdFromUrl };
