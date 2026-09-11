'use strict';
// TikTok 链接提取、视频解析（直连 + 第三方兜底）与文件下载
const fs = require('fs');
const https = require('https');
const { UA, REHYDRATION_MARKER, NETWORK_PATTERNS } = require('./constants');
const { httpsGet } = require('./request');
// 重试 / 退避统一走 lib/retry.js（与视频上传、开放平台等链路共用同一骨架）
const { retry, jitteredLinearBackoff } = require('../lib/retry');

// ---------- 链接处理 ----------

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

// ---------- 第三方接口兜底 ----------

/**
 * 通过第三方解析接口获取无水印地址。
 * 当 TikTok 页面被风控拦截（返回空壳页）时，用此方式走一条完全不同的链路，
 * 绕过页面级风控。按顺序尝试多个来源，全部失败才抛错。
 */
async function fetchViaThirdParty(url, { agent, signal, onLog = () => {} }) {
  let videoId = extractVideoIdFromUrl(url);
  const headers = {
    'User-Agent': UA,
    'Accept': 'application/json,text/plain,*/*',
    'Referer': 'https://www.tiktok.com/',
  };
  // 第三方解析来源列表：pick 返回无水印地址，并从其中附带视频 id（短链接时用于命名）
  const sources = [
    {
      name: 'tikwm',
      build: (u) => 'https://www.tikwm.com/api/?url=' + encodeURIComponent(u),
      pick: (j) => ({
        play: (j?.data?.play && typeof j.data.play === 'string' ? j.data.play : ''),
        id: (j?.data?.id && String(j.data.id)) || '',
      }),
    },
  ];
  let firstErr = null;
  for (const src of sources) {
    if (signal && signal.aborted) throw new Error('aborted');
    try {
      onLog(`尝试第三方接口（${src.name}）解析无水印地址...`);
      const r = await httpsGet(src.build(url), { agent, headers, signal, timeout: 20000 });
      if (r.status !== 200) throw new Error('接口返回 HTTP ' + r.status);
      const { play, id } = src.pick(JSON.parse(r.body));
      if (!play) throw new Error('接口未返回视频地址');
      if (!videoId && id) videoId = id;
      return { videoId, downloadUrl: play, playUrl: '', awemeUrl: '', cookies: '' };
    } catch (e) {
      if (signal && signal.aborted) throw e;
      firstErr = firstErr || e;
      onLog(`第三方接口（${src.name}）失败：${e.message}`);
    }
  }
  throw new Error(`第三方接口兜底失败（${(firstErr && firstErr.message) || '未知错误'}）`);
}

/**
 * 解析单个视频：优先直连解析页面；被风控拦截时改用第三方接口兜底。
 */
async function parseVideo(url, { agent, session = {}, onLog = () => {}, signal }) {
  try {
    return await parseViaPage(url, { agent, session, signal, onLog });
  } catch (e) {
    if (signal && signal.aborted) throw e;
    onLog(`页面直连解析失败（${e.message}），改为第三方接口兜底...`);
    return await fetchViaThirdParty(url, { agent, signal, onLog });
  }
}

/** 下载文件到指定路径（自动跟随重定向，aweme 接口会 302 到实际 CDN 地址） */
function downloadFile(url, destPath, cookies, agent, redirects = 5, signal) {
  return new Promise((resolve, reject) => {
    const out = fs.createWriteStream(destPath);
    // 立即挂载写流错误监听：文件创建失败（权限/磁盘满/被占用等）时 error 会异步立即触发，
    // 若等响应回调里才挂监听，就会变成未处理的 'error' 事件导致整个 node 进程崩溃（SSE 断流）。
    out.on('error', reject);
    // 清理半成品文件：中止或失败时移除 .part 残留
    const cleanup = () => {
      try { out.destroy(); } catch {}
      try { fs.rmSync(destPath, { force: true }); } catch {}
    };
    const req = https.request(url, {
      agent,
      headers: {
        'User-Agent': UA,
        'Accept': 'video/webm,video/mp4,video/*;q=0.9,*/*;q=0.8',
        'Referer': 'https://www.tiktok.com/',
        ...(cookies ? { 'Cookie': cookies } : {}),
      },
      timeout: 180000,
    }, (res) => {
      // 302 重定向：aweme/v1/play 接口返回 302 到实际 CDN 视频地址
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects > 0) {
        out.destroy();
        const next = new URL(res.headers.location, url).toString();
        res.resume();
        downloadFile(next, destPath, cookies, agent, redirects - 1, signal).then(resolve, reject);
        return;
      }
      if (res.statusCode !== 200) {
        cleanup();
        reject(new Error('视频下载返回 HTTP ' + res.statusCode));
        res.resume();
        return;
      }
      res.pipe(out);
      out.on('finish', () => resolve({ bytes: fs.statSync(destPath).size }));
    });
    const onAbort = () => { cleanup(); req.destroy(new Error('aborted')); };
    if (signal) {
      if (signal.aborted) onAbort();
      else signal.addEventListener('abort', onAbort, { once: true });
    }
    req.on('timeout', () => { cleanup(); req.destroy(new Error('timeout')); });
    req.on('error', reject);
    req.end();
  });
}

// ---------- 错误分类 ----------

/** 判断错误是否为网络问题（用于提示开启 VPN） */
function isNetworkError(e) {
  const msg = String(e?.message || e).toLowerCase();
  return NETWORK_PATTERNS.some((p) => msg.includes(p));
}

module.exports = {
  extractUrls,
  extractVideoIdFromUrl,
  parseViaPage,
  fetchViaThirdParty,
  parseVideo,
  downloadFile,
  isNetworkError,
};
