'use strict';
// 第三方接口兜底：直连页被风控拦截时，走一条完全不同的链路绕过页面级风控
const { UA } = require('./constants');
const { httpsGet } = require('./request');
const { extractVideoIdFromUrl } = require('./links');
const { parseViaPage } = require('./parse-page');

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

module.exports = { fetchViaThirdParty, parseVideo };
