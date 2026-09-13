'use strict';
// 直连解析单个视频页（主方式），返回无水印地址 + cookie
const { UA, REHYDRATION_MARKER } = require('./constants');
const { httpsGet } = require('./request');
// 重试 / 退避统一走 lib/retry.js（与视频上传、开放平台等链路共用同一骨架）
const { retry, jitteredLinearBackoff } = require('../lib/retry');
const { extractVideoIdFromUrl } = require('./links');

/** 直连解析单个视频页（主方式），返回无水印地址 + cookie */
async function parseViaPage(url, { agent, session = {}, onLog = () => {}, signal }) {
  // 优先复用跨视频共享的会话 Cookie（ttwid 等），降低被风控识别为陌生批量请求的概率
  let cookies = session.cookies || '';
  const aborted = () => !!(signal && signal.aborted);
  return retry(async () => {
    const page = await httpsGet(url, {
      agent,
      signal,
      headers: {
        'User-Agent': UA,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': 'https://www.tiktok.com/',
        ...(cookies ? { 'Cookie': cookies } : {}),
      },
    });
    if (page.status !== 200) throw new Error('页面返回 HTTP ' + page.status);
    // 保留最近一次响应的 cookie，重试及后续视频复用（更接近真实浏览器行为）
    if (page.cookies) {
      cookies = page.cookies;
      session.cookies = page.cookies;
    }

    const start = page.body.indexOf(REHYDRATION_MARKER);
    // 无视频数据：TikTok 风控会返回约 43KB 的空壳页（无 ttwid、含 pumbaa 验证脚本），
    // 等待片刻后通常自动恢复，因此不要误报“视频不存在”，一律重试
    if (start < 0) {
      const isRisk = page.body.length < 100000;
      throw new Error(isRisk
        ? '页面被 TikTok 风控拦截（空壳页，无视频数据）'
        : '页面未包含视频数据');
    }
    const jsonStart = start + REHYDRATION_MARKER.length;
    const jsonEnd = page.body.indexOf('</script>', jsonStart);
    if (jsonEnd < 0) throw new Error('页面数据不完整');
    const data = JSON.parse(page.body.slice(jsonStart, jsonEnd));
    const item = data?.__DEFAULT_SCOPE__?.['webapp.video-detail']?.itemInfo?.itemStruct;
    // 页面完整但无视频信息，此时才是真正的“视频不存在”
    if (!item) throw new Error('视频不存在或已被删除');

    const videoId = item.id || extractVideoIdFromUrl(url) || '';
    const downloadUrl = typeof item.video?.downloadAddr === 'string' ? item.video.downloadAddr : '';
    const playUrl = typeof item.video?.playAddr === 'string' ? item.video.playAddr : '';
    // 无水印地址：aweme/v1/play 接口（页面 PlayAddrStruct.UrlList 中带签名的地址）
    const playList = Array.isArray(item.video?.PlayAddrStruct?.UrlList) ? item.video.PlayAddrStruct.UrlList : [];
    const awemeUrl = playList.find((u) => typeof u === 'string' && u.includes('/aweme/v1/play/')) || '';
    if (!awemeUrl && !downloadUrl && !playUrl) throw new Error('未找到视频地址');
    return { videoId, downloadUrl, playUrl, awemeUrl, cookies: page.cookies };
  }, {
    attempts: 5,
    // 间隔递增 + 随机抖动，降低被风控模式识别的概率
    waitOf: jitteredLinearBackoff(3000, 2000),
    onRetry: (e, attempt, waitMs) => {
      onLog(`解析失败（${e.message}），${Math.round(waitMs / 1000)} 秒后第 ${attempt + 1} 次重试...`);
    },
    isAborted: aborted,
  }).catch((e) => {
    if (aborted()) throw e;
    throw new Error(`多次重试仍未能获取视频数据（${e.message}；可能是风控拦截或链接已失效）`);
  });
}

module.exports = { parseViaPage };
