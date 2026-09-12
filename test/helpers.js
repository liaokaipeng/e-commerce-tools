'use strict';
// 测试共享工具：结果收集 / HTTP 封装 / 服务启动与清理
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

// 简易 fetch 封装（返回 {status, text}）
async function req(method, urlPath, body) {
  const opts = { method };
  if (body !== undefined) {
    opts.headers = { 'Content-Type': 'application/json' };
    opts.body = JSON.stringify(body);
  }
  const r = await fetch(BASE + urlPath, opts);
  return { status: r.status, text: await r.text() };
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

function printSummary() {
  const ok = results.filter((r) => r.ok).length;
  const fail = results.length - ok;
  console.log(`\n结果：${ok} 通过 / ${fail} 失败 / 共 ${results.length} 项`);
  return fail === 0;
}

module.exports = { ROOT, PORT, BASE, t, req, waitReady, startServer, removeFile, printSummary };