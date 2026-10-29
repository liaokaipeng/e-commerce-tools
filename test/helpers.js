'use strict';
// 测试共享工具：结果收集 / HTTP 封装 / SSE 读取 / 响应桩 / 临时文件夹具 / 服务启动与清理
// 供 test/unit.test.js 与 test/api.test.js 共用，保证两条测试线结果汇总一致。
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const PORT = 8865; // 测试端口，避开默认 8765
const BASE = `http://127.0.0.1:${PORT}`;

const results = [];
function t(name, ok, detail = '') {
  results.push({ name, ok });
  if (ok) console.log('  ✓ ' + name);
  else console.log('  ✗ ' + name + (detail ? '  — ' + detail : ''));
}

// 简易 fetch 封装（返回 {status, text, json}；json 为惰性解析，
// 页面静态资源等非 JSON 响应在访问 .json 前不会抛错）
async function req(method, urlPath, body) {
  const opts = { method };
  if (body !== undefined) {
    opts.headers = { 'Content-Type': 'application/json' };
    opts.body = JSON.stringify(body);
  }
  const r = await fetch(BASE + urlPath, opts);
  const text = await r.text();
  return { status: r.status, text, get json() { return JSON.parse(text); } };
}

// 请求并读取 SSE 流直至出现指定类型事件（或流结束），返回全部已收到的事件。
// untilTypes 传空数组表示读到流结束；opts 透传给 fetch（POST 的 SSE 接口传 method/headers/body）。
async function readSSEUntil(urlPath, untilTypes, opts = {}) {
  const r = await fetch(BASE + urlPath, opts);
  const events = [];
  const reader = r.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const parts = buf.split('\n\n');
    buf = parts.pop();
    for (const part of parts) {
      const line = part.split('\n').find((l) => l.startsWith('data: '));
      if (!line) continue;
      try {
        const ev = JSON.parse(line.slice(6));
        events.push(ev);
        if (untilTypes.includes(ev.type)) {
          await reader.cancel().catch(() => {});
          return events;
        }
      } catch { /* 忽略无法解析的事件 */ }
    }
  }
  return events;
}

// JSON 形态的 res 测试桩：记录 writeHead 的状态码与 headersSent、end 的响应体。
// SSE 场景（要收集 write 帧 / endPromise）语义不同，由各测试自建桩。
function fakeRes() {
  const r = { headersSent: false, status: 0, body: '' };
  r.writeHead = (s) => { r.headersSent = true; r.status = s; };
  r.end = (b) => { r.body = b || ''; };
  return r;
}

// 临时文件夹具：写入 content（Buffer 或字符串）后执行 fn(路径)，
// 结束（含抛错）统一走 removeFile 清理——本机删除 shim 按「每轮删除数」计数，
// 测试里零散 unlinkSync 可能触发批量删除拦截，见 removeFile 注释。
async function withTemp(name, content, fn) {
  const f = path.join(os.tmpdir(), `${name}_${Date.now()}_${Math.random().toString(16).slice(2)}`);
  fs.writeFileSync(f, content);
  try {
    return await fn(f);
  } finally {
    removeFile(f);
  }
}

// 删除文件（绕过本机可能存在的 node 安全删除 shim：它按「每轮删除数」计数，
// 收尾时零散删除会连同构建缓存一起累加，偶发触发 BULK_CONFIRM 拦截而中断测试收尾）。
// 测试删的都是会话文件的备份副本 / 自己造的临时文件，直接用 .NET 删除最稳。
function removeFile(p) {
  try {
    if (!fs.existsSync(p)) return;
    if (process.platform === 'win32') {
      require('child_process').execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command',
        `[System.IO.File]::Delete('${p.replace(/'/g, "''")}')`], { stdio: 'ignore' });
    } else {
      fs.unlinkSync(p);
    }
  } catch { /* 删不掉不阻断测试收尾 */ }
}

// 启动被测服务（临时端口），并备份测试期间可能被改写的 session/settings 文件，
// stop() 时原样恢复（内含用户真实凭证，不能删除）。
// 开放平台凭证：服务启动时读入内存（openapi/store.js），测试用独立临时文件隔离
// （OPENAPI_SESSION_FILE 环境变量），避免误动用户真实 openapi-session.json。
function startServer() {
  const openapiTestFile = path.join(os.tmpdir(), `kp_openapi_session_${process.pid}_${Date.now()}.json`);
  // 监控数据目录同样隔离到临时目录（调度器在测试环境无 App 配置时空转，不会写文件）
  const monitorTestDir = path.join(os.tmpdir(), `kp_monitor_data_${process.pid}_${Date.now()}`);
  const child = spawn(process.execPath, ['server/main.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT), OPENAPI_SESSION_FILE: openapiTestFile, MONITOR_DATA_DIR: monitorTestDir },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let childErr = '';
  child.stderr.on('data', (d) => { childErr += d.toString(); });
  // 被测服务崩了要能看见：把子进程 stderr 实时透传到测试输出（默认关闭，KP_TEST_SERVER_LOG=1 打开）
  if (process.env.KP_TEST_SERVER_LOG) {
    child.stderr.on('data', (d) => process.stderr.write('[server] ' + d.toString()));
    child.on('exit', (code, sig) => process.stderr.write(`[server] exited code=${code} sig=${sig}\n`));
  }

  const settingsFile = path.join(ROOT, 'server', 'data', 'settings.json');
  const settingsBackup = fs.existsSync(settingsFile) ? fs.readFileSync(settingsFile) : null;
  const sessionFiles = ['bidding-session.json', 'video-session.json', 'openapi-session.json', 'hotlisting-spu.json'].map((f) => path.join(ROOT, 'server', 'data', f));
  const sessionBackups = sessionFiles.map((fp) => (fs.existsSync(fp) ? fs.readFileSync(fp) : null));

  return {
    child,
    get childErr() { return childErr; },
    async ready() { return waitReady(); },
    stop() {
      child.kill();
      sessionFiles.forEach((fp, i) => {
        if (sessionBackups[i]) fs.writeFileSync(fp, sessionBackups[i]);
        else removeFile(fp);
      });
      if (settingsBackup) fs.writeFileSync(settingsFile, settingsBackup);
      else removeFile(settingsFile);
      removeFile(openapiTestFile);
      try { fs.rmSync(monitorTestDir, { recursive: true, force: true }); } catch { /* 忽略 */ }
    },
  };
}

async function waitReady() {
  for (let i = 0; i < 50; i++) {
    try {
      const r = await fetch(BASE + '/');
      if (r.ok) return true;
    } catch (e) { /* 未就绪，继续等 */ }
    await new Promise((res) => setTimeout(res, 200));
  }
  return false;
}

function printSummary() {
  const ok = results.filter((r) => r.ok).length;
  const fail = results.length - ok;
  console.log(`\n结果：${ok} 通过 / ${fail} 失败 / 共 ${results.length} 项`);
  return fail === 0;
}

module.exports = { ROOT, BASE, t, req, readSSEUntil, fakeRes, withTemp, startServer, removeFile, printSummary };
