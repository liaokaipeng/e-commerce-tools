// TikTok 无水印视频下载工具 - 本地服务
const http = require('http');
const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');
const { runBatch, extractUrls, detectProxy } = require('./tiktok');

const PORT = process.env.PORT || 8737;
const PUBLIC_DIR = path.join(__dirname, 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

function serveStatic(req, res, urlPath) {
  let filePath = path.join(PUBLIC_DIR, urlPath === '/' ? 'index.html' : urlPath);
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404 Not Found');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (c) => { body += c; if (body.length > 2 * 1024 * 1024) req.destroy(); });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  // 静态资源
  if (req.method === 'GET' && (url.pathname === '/' || url.pathname.startsWith('/assets/'))) {
    serveStatic(req, res, url.pathname);
    return;
  }

  // 健康/代理状态
  if (req.method === 'GET' && url.pathname === '/api/status') {
    const defaultDir = process.env.USERPROFILE || process.env.HOME || __dirname;
    sendJson(res, 200, {
      ok: true,
      proxy: detectProxy() || null,
      defaultDir: path.join(defaultDir, 'Downloads', 'tiktok_videos'),
      version: '1.0.0',
    });
    return;
  }

  // 打开保存目录
  if (req.method === 'POST' && url.pathname === '/api/open-dir') {
    try {
      const { dir } = JSON.parse(await readBody(req));
      const d = (dir || '').trim();
      if (!d) {
        sendJson(res, 400, { ok: false, message: '请先填写保存目录' });
        return;
      }
      // 目录不存在则自动创建，确保始终可打开
      fs.mkdirSync(d, { recursive: true });
      // 用 cmd start 打开（比直接调用 explorer 更可靠）
      execFile('cmd.exe', ['/c', 'start', '', d], { windowsHide: true }, () => {});
      sendJson(res, 200, { ok: true });
    } catch (e) {
      sendJson(res, 500, { ok: false, message: e.message });
    }
    return;
  }

  // 批量下载（SSE 流式进度）
  if (req.method === 'POST' && url.pathname === '/api/download') {
    let payload;
    try {
      // 容错：剥离 BOM 与首尾空白后再解析
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
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write('retry: 2000\n\n');

    const emit = (event) => {
      try { res.write(`data: ${JSON.stringify(event)}\n\n`); } catch { /* client gone */ }
    };

    // 立即返回一次链接确认
    emit({ type: 'info', message: `共 ${urls.length} 个链接，开始下载...` });

    runBatch(urls, saveDir, emit).then(() => {
      try { res.end(); } catch { /* ignore */ }
    }).catch((e) => {
      emit({ type: 'fatal', message: `任务异常：${e.message}` });
      try { res.end(); } catch { /* ignore */ }
    });
    return;
  }

  sendJson(res, 404, { ok: false, message: 'Not Found' });
});

server.listen(PORT, () => {
  console.log(`==========================================`);
  console.log(` TikTok 无水印视频下载工具已启动`);
  console.log(` 请在浏览器打开: http://localhost:${PORT}`);
  console.log(` 按 Ctrl+C 停止服务`);
  console.log(`==========================================`);
});
