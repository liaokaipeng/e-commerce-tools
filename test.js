// 工具合集 - 冒烟测试
// 运行：node test.js
// 说明：不依赖真实网络（TikTok/Shopee），仅验证合并服务路由与本地纯函数。
//       会临时启动一个服务实例到测试端口，测完自动关闭并清理测试产生的 session 文件。
'use strict';
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { extractUrls } = require('./tiktok');

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

async function main() {
  const child = spawn(process.execPath, ['main.js'], {
    cwd: __dirname,
    env: { ...process.env, PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let childErr = '';
  child.stderr.on('data', (d) => { childErr += d.toString(); });

  // 备份并清理测试期间可能改动的默认目录配置（settings.json）
  const settingsFile = path.join(__dirname, 'settings.json');
  const settingsBackup = fs.existsSync(settingsFile) ? fs.readFileSync(settingsFile) : null;

  try {
    if (!(await waitReady())) {
      console.log('\n服务未能启动，无法执行接口测试。stderr:\n' + childErr);
      process.exitCode = 1;
      return;
    }

    console.log('===== 页面静态资源 =====');
    for (const p of ['/', '/tiktok/', '/bidding/', '/video/', '/xlsx.full.min.js']) {
      const r = await req('GET', p);
      t(`GET ${p} 返回 200`, r.status === 200, `status=${r.status}`);
    }

    console.log('===== TikTok 下载 API =====');
    {
      const r = await req('GET', '/api/tiktok/status');
      t('GET /api/tiktok/status 返回 200', r.status === 200, r.text);
      if (r.status === 200) {
        const j = JSON.parse(r.text);
        t('/api/tiktok/status 含 ok=true 与 defaultDir', j.ok === true && (j.defaultDir === null || typeof j.defaultDir === 'string'));
      }
    }

    console.log('===== 工具默认目录设置 API =====');
    {
      const r = await req('GET', '/api/settings');
      const j = JSON.parse(r.text);
      t('GET /api/settings 返回 ok 与 defaults', r.status === 200 && j.ok === true && 'tiktok' in j.defaults && 'bidding' in j.defaults);
      const p = await req('POST', '/api/settings', { tool: 'tiktok', dir: 'C:\\test\\dir' });
      const pj = JSON.parse(p.text);
      t('POST /api/settings 设置默认目录', p.status === 200 && pj.ok === true);
      const invalid = await req('POST', '/api/settings', { tool: 'xxx', dir: 'C:\\x' });
      t('POST /api/settings 非法工具返回 400', invalid.status === 400);
    }

    console.log('===== 目录浏览 API =====');
    {
      const r = await req('GET', '/api/browse');
      const j = JSON.parse(r.text);
      t('GET /api/browse 返回 ok 且含 dirs', r.status === 200 && j.ok === true && Array.isArray(j.dirs));
      const bad = await req('GET', '/api/browse?path=' + encodeURIComponent('Z:\\不存在的盘或目录\\x'));
      t('GET /api/browse 无效路径返回 400', bad.status === 400);
    }

    console.log('===== 竞价导出 API =====');
    {
      const r = await req('GET', '/api/status');
      t('GET /api/status 返回 200', r.status === 200, r.text);
      if (r.status === 200) t('/api/status 含 loggedIn 字段', 'loggedIn' in JSON.parse(r.text));
    }
    {
      const r = await req('GET', '/api/stores');
      const n = r.status === 200 ? JSON.parse(r.text).length : -1;
      t('GET /api/stores 返回 12 个店铺', n === 12, `count=${n}`);
    }
    {
      // 模拟竞价扩展推送 Cookie
      const r = await req('POST', '/api/cookie', {
        savedAt: new Date().toISOString(),
        cookies: [{ name: 'SPC_F', value: 'test', domain: 'seller.shopee.cn', path: '/', httpOnly: true }],
      });
      t('POST /api/cookie（扩展推送）返回 ok', r.text === 'ok', r.text);
    }

    console.log('===== 视频上传 API =====');
    {
      const r = await req('GET', '/api/creds');
      t('GET /api/creds 返回 200', r.status === 200, r.text);
    }
    {
      // 模拟视频上传扩展推送凭证（按站点批量）
      const r = await req('POST', '/api/creds', {
        sites: {
          cn: { auth: 'NTAwMDcyMjU6dGVzdA==', cookie: 'video_upload_session_id=1; SPC_F=2', shopId: '557630453' },
        },
      });
      t('POST /api/creds（扩展推送）返回 ok', r.status === 200 && JSON.parse(r.text).ok === true, r.text);
    }

    console.log('===== 404 兜底 =====');
    {
      const r = await req('GET', '/api/not-exist');
      t('GET /api/not-exist 返回 404', r.status === 404, `status=${r.status}`);
    }

    console.log('===== 本地纯函数（TikTok 链接提取） =====');
    {
      const urls = extractUrls('https://www.tiktok.com/@a/video/123\nhttp://vm.tiktok.com/abc\n不是链接');
      t('extractUrls 只识别有效链接', urls.length === 2, `got=${urls.length}`);
      t('extractUrls 空输入返回空数组', extractUrls('').length === 0);
    }
  } finally {
    child.kill();
    // 清理测试产生的 session 文件
    for (const f of ['bidding-session.json', 'video-session.json']) {
      const fp = path.join(__dirname, f);
      if (fs.existsSync(fp)) fs.unlinkSync(fp);
    }
    // 恢复测试前被改动的默认目录配置
    if (settingsBackup) fs.writeFileSync(settingsFile, settingsBackup);
    else if (fs.existsSync(settingsFile)) fs.unlinkSync(settingsFile);
  }

  const ok = results.filter((r) => r.ok).length;
  const fail = results.length - ok;
  console.log(`\n结果：${ok} 通过 / ${fail} 失败 / 共 ${results.length} 项`);
  process.exitCode = fail > 0 ? 1 : 0;
}

main().catch((e) => {
  console.error('测试执行异常：', e);
  process.exitCode = 1;
});