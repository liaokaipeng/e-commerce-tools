'use strict';
// 批量下载编排（代理检测、逐条解析下载、进度事件、取消）
const fs = require('fs');
const path = require('path');
const { sleep } = require('./constants');
const { detectProxy, createAgent } = require('./proxy');
const { parseVideo, downloadFile, isNetworkError } = require('./parse');

/**
 * 批量下载
 * @param {string[]} urls 链接列表
 * @param {string} saveDir 保存目录
 * @param {(event: object) => void} emit 事件回调
 * @param {AbortSignal} signal 取消信号
 */
async function runBatch(urls, saveDir, emit, signal) {
  const dir = saveDir || path.join(process.env.USERPROFILE || process.env.HOME || '.', 'Downloads', 'tiktok_videos');
  const isAborted = () => !!(signal && signal.aborted);
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (e) {
    emit({ type: 'fatal', message: `无法创建保存目录：${e.message}` });
    return;
  }

  const proxy = detectProxy();
  const agent = createAgent(proxy);
  emit({ type: 'info', message: proxy
    ? `已使用代理：${proxy}`
    : '未检测到系统代理，将尝试直连（若失败请开启 VPN）' });
  emit({ type: 'info', message: `保存目录：${dir}` });

  let success = 0;
  let failed = 0;
  let networkError = false;
  // 跨视频共享的会话状态（复用 ttwid，降低风控概率）
  const session = {};

  for (let i = 0; i < urls.length; i++) {
    if (isAborted()) break;
    const url = urls[i];
    emit({ type: 'start', index: i + 1, total: urls.length, url });

    try {
      const v = await parseVideo(url, { agent, session, signal, onLog: (m) => emit({ type: 'log', url, message: m }) });
      if (isAborted()) break;
      emit({ type: 'log', url, message: `解析成功：视频ID ${v.videoId}` });

      const filePath = path.join(dir, `${v.videoId}.mp4`);
      // 已存在则跳过
      if (fs.existsSync(filePath) && fs.statSync(filePath).size > 0) {
        emit({ type: 'done', url, ok: true, message: `已存在，跳过：${v.videoId}.mp4`, file: filePath });
        success++;
        continue;
      }

      let downloaded = false;
      // 优先无水印地址（aweme/v1/play），其次 downloadAddr/playAddr 兜底
      const candidates = [
        ['aweme/v1/play（无水印）', v.awemeUrl],
        ['downloadAddr', v.downloadUrl],
        ['playAddr', v.playUrl],
      ];
      for (const [name, u] of candidates) {
        if (!u || isAborted()) break;
        try {
          emit({ type: 'log', url, message: `正在通过 ${name} 下载...` });
          const tmp = filePath + '.part';
          await downloadFile(u, tmp, v.cookies, agent, 5, signal);
          fs.renameSync(tmp, filePath);
          downloaded = true;
          break;
        } catch (e) {
          if (isAborted()) break;
          emit({ type: 'log', url, message: `${name} 下载失败（${e.message}），尝试备用地址...` });
        }
      }

      if (isAborted()) break;
      if (!downloaded) {
        throw new Error('所有视频地址均下载失败');
      }
      emit({ type: 'done', url, ok: true, message: `下载完成：${v.videoId}.mp4`, file: filePath });
      success++;
    } catch (e) {
      if (isAborted()) break;
      failed++;
      if (isNetworkError(e)) networkError = true;
      emit({
        type: 'done',
        url,
        ok: false,
        message: `跳过：${e.message}${isNetworkError(e) ? '（网络问题）' : ''}`,
        network: isNetworkError(e),
      });
    }
    // 间隔请求 + 随机抖动，降低被风控识别为批量脚本的概率
    if (i < urls.length - 1) await sleep(3000 + Math.floor(Math.random() * 1500));
    if (isAborted()) break;
  }

  if (isAborted()) {
    emit({ type: 'summary', success, failed, networkError, message: `任务已手动中止：成功 ${success} 个，失败 ${failed} 个。` });
    return;
  }

  emit({
    type: 'summary',
    success,
    failed,
    networkError,
    message: networkError
      ? `任务结束：成功 ${success} 个，失败 ${failed} 个。检测到网络问题，如持续失败请开启 VPN 后重试。`
      : `任务结束：成功 ${success} 个，失败 ${failed} 个。`,
  });
}

module.exports = { runBatch };
