// TikTok 无水印视频下载核心模块
const fs = require('fs');
const path = require('path');
const https = require('https');
const { execFileSync, execFile } = require('child_process');
const { HttpsProxyAgent } = require('https-proxy-agent');
const { SocksProxyAgent } = require('socks-proxy-agent');
const { sendJson, readBody } = require('./lib/http-utils');
const { getDefault } = require('./lib/settings');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const REHYDRATION_MARKER = '<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application/json">';

// ---------- 代理检测 ----------

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

// ---------- HTTP 请求 ----------

function httpsGet(url, { agent, headers = {}, method = 'GET', timeout = 30000, redirects = 5, onResponse, signal } = {}) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, { agent, headers, method, timeout }, (res) => {
      // 重定向处理
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects > 0) {
        res.resume();
        const nextUrl = new URL(res.headers.location, url).toString();
        httpsGet(nextUrl, { agent, headers, method, timeout, redirects: redirects - 1, onResponse, signal })
          .then(resolve, reject);
        return;
      }
      const cookies = (res.headers['set-cookie'] || []).map(c => c.split(';')[0]).join('; ');
      if (onResponse) { onResponse(res, cookies); return; }
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (c) => data += c);
      res.on('end', () => resolve({ status: res.statusCode, body: data, cookies }));
    });
    const onAbort = () => req.destroy(new Error('aborted'));
    if (signal) {
      if (signal.aborted) onAbort();
      else signal.addEventListener('abort', onAbort, { once: true });
    }
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.end();
  });
}

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

/** 解析单个视频页，返回无水印地址 + cookie */
async function parseVideo(url, { agent, session = {}, onLog = () => {}, signal }) {
  let lastError = null;
  // 优先复用跨视频共享的会话 Cookie（ttwid 等），降低被风控识别为陌生批量请求的概率
  let cookies = session.cookies || '';
  for (let attempt = 1; attempt <= 5; attempt++) {
    if (signal && signal.aborted) throw new Error('aborted');
    try {
      let page = await httpsGet(url, {
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
    } catch (e) {
      lastError = e;
      if (signal && signal.aborted) break;
      if (attempt < 5) {
        // 间隔递增 + 随机抖动，降低被风控模式识别的概率
        const wait = 3000 * attempt + Math.floor(Math.random() * 2000);
        onLog(`解析失败（${e.message}），${Math.round(wait / 1000)} 秒后第 ${attempt + 1} 次重试...`);
        await sleep(wait);
      }
    }
  }
  throw new Error(`多次重试仍未能获取视频数据（${lastError.message}；可能是风控拦截或链接已失效）`);
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

const NETWORK_PATTERNS = [
  'timeout', 'etimedout', 'econnreset', 'econnrefused', 'eai_again',
  'enetunreach', 'enotfound', 'getaddrinfo', 'socket hang up',
  'unable to connect', 'network is unreachable', 'tunnel', 'proxy',
  'certificate', 'self signed', 'tls', 'deadline exceeded',
];

/** 判断错误是否为网络问题（用于提示开启 VPN） */
function isNetworkError(e) {
  const msg = String(e?.message || e).toLowerCase();
  return NETWORK_PATTERNS.some((p) => msg.includes(p));
}

// ---------- 下载任务 ----------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 批量下载
 * @param {string[]} urls 链接列表
 * @param {string} saveDir 保存目录
 * @param {(event: object) => void} emit 事件回调
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

// ============ 路由处理（SSE 下载 / 状态 / 打开目录） ============

/** GET /api/tiktok/status */
function handleStatus(req, res) {
  sendJson(res, 200, {
    ok: true,
    proxy: detectProxy() || null,
    defaultDir: getDefault('tiktok'), // 未设置过时为 null，前端提示用户自选目录
    version: '1.0.0',
  });
}

/** POST /api/open-dir */
async function handleOpenDir(req, res) {
  try {
    const { dir } = JSON.parse(await readBody(req));
    const d = (dir || '').trim();
    if (!d) {
      sendJson(res, 400, { ok: false, message: '请先填写保存目录' });
      return;
    }
    fs.mkdirSync(d, { recursive: true });
    execFile('cmd.exe', ['/c', 'start', '', d], { windowsHide: true }, () => {});
    sendJson(res, 200, { ok: true });
  } catch (e) {
    sendJson(res, 500, { ok: false, message: e.message });
  }
}

/** POST /api/download（SSE 流式进度） */
async function handleDownload(req, res) {
  let payload;
  try {
    const raw = (await readBody(req)).replace(/^\uFEFF/, '').trim();
    payload = JSON.parse(raw);
  } catch {
    sendJson(res, 400, { ok: false, message: '无效的请求体' });
    return;
  }
  const urls = extractUrls(payload.urls || '');
  const saveDir = (payload.dir || '').trim();

  if (urls.length === 0) {
    sendJson(res, 400, { ok: false, message: '未识别到有效的 TikTok 链接，请检查输入（每行一个链接）' });
    return;
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write('retry: 2000\n\n');

  const emit = (event) => {
    try { res.write(`data: ${JSON.stringify(event)}\n\n`); } catch { /* client gone */ }
  };

  emit({ type: 'info', message: `共 ${urls.length} 个链接，开始下载...` });

  // 客户端断开（用户点击“停止下载”会 abort fetch）时，中止整个下载任务
  const controller = new AbortController();
  res.on('close', () => controller.abort());

  runBatch(urls, saveDir, emit, controller.signal).then(() => {
    try { res.end(); } catch { /* ignore */ }
  }).catch((e) => {
    if (controller.signal.aborted) return;
    emit({ type: 'fatal', message: `任务异常：${e.message}` });
    try { res.end(); } catch { /* ignore */ }
  });
}

/** 注册路由 */
function register({ get, post }) {
  get('/api/tiktok/status', handleStatus);
  post('/api/open-dir', handleOpenDir);
  post('/api/download', handleDownload);
}

module.exports = { runBatch, extractUrls, detectProxy, register };
