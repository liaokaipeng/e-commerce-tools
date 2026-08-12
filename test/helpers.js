'use strict';
// 测试共享工具：结果收集 / HTTP 封装 / 服务启动与清理
// 供 test/unit.test.js 与 test/api.test.js 共用，保证两条测试线结果汇总一致。
const { spawn } = require('child_process');
const path = require('path');
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

// 启动被测服务（临时端口），并备份测试期间可能被改写的 session/settings 文件，
// stop() 时原样恢复（内含用户真实凭证，不能删除）。
function startServer() {
  const child = spawn(process.execPath, ['main.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let childErr = '';
  child.stderr.on('data', (d) => { childErr += d.toString(); });

  const settingsFile = path.join(ROOT, 'settings.json');
  const settingsBackup = fs.existsSync(settingsFile) ? fs.readFileSync(settingsFile) : null;
  const sessionFiles = ['bidding-session.json', 'video-session.json'].map((f) => path.join(ROOT, f));
  const sessionBackups = sessionFiles.map((fp) => (fs.existsSync(fp) ? fs.readFileSync(fp) : null));

  return {
    child,
    get childErr() { return childErr; },
    async ready() { return waitReady(); },
    stop() {
      child.kill();
      sessionFiles.forEach((fp, i) => {
        if (sessionBackups[i]) fs.writeFileSync(fp, sessionBackups[i]);
        else if (fs.existsSync(fp)) fs.unlinkSync(fp);
      });
      if (settingsBackup) fs.writeFileSync(settingsFile, settingsBackup);
      else if (fs.existsSync(settingsFile)) fs.unlinkSync(settingsFile);
    },
  };
}

function printSummary() {
  const ok = results.filter((r) => r.ok).length;
  const fail = results.length - ok;
  console.log(`\n结果：${ok} 通过 / ${fail} 失败 / 共 ${results.length} 项`);
  return fail === 0;
}

module.exports = { ROOT, PORT, BASE, t, req, waitReady, startServer, printSummary };