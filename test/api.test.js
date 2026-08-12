'use strict';
// 接口冒烟测试：临时端口 8865，不访问真实站点（TikTok/Shopee）。
// 只验证合并服务的路由、静态托管与本地逻辑；session 凭证文件测试前备份、结束后原样恢复。
const { BASE, t, req, startServer } = require('./helpers');

// 读取 SSE 流直至出现指定类型事件，返回全部已收到的事件
async function readSSEUntil(urlPath, untilTypes) {
  const r = await fetch(BASE + urlPath);
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

async function run() {
  const srv = startServer();
  try {
    if (!(await srv.ready())) {
      console.log('\n服务未能启动，无法执行接口测试。stderr:\n' + srv.childErr);
      t('服务启动', false, srv.childErr);
      return;
    }

    console.log('  -- 页面静态资源 --');
    for (const p of ['/', '/tiktok/', '/bidding/', '/video/', '/video/?mode=cn', '/video/?mode=ph', '/xlsx.full.min.js']) {
      const r = await req('GET', p);
      t(`GET ${p} 返回 200`, r.status === 200, `status=${r.status}`);
    }
    {
      const r = await req('OPTIONS', '/api/creds');
      t('OPTIONS 预检返回 204', r.status === 204, `status=${r.status}`);
    }

    console.log('  -- TikTok 下载 API --');
    {
      const r = await req('GET', '/api/tiktok/status');
      t('GET /api/tiktok/status 返回 200', r.status === 200, r.text);
      if (r.status === 200) {
        const j = JSON.parse(r.text);
        t('/api/tiktok/status 含 ok=true、defaultDir、proxy、version', j.ok === true && (j.defaultDir === null || typeof j.defaultDir === 'string') && 'proxy' in j && typeof j.version === 'string');
      }
    }
    {
      const r = await req('POST', '/api/download', { urls: '不是链接', dir: '' });
      t('POST /api/download 无有效链接返回 400', r.status === 400, `status=${r.status}`);
    }
    {
      const r = await req('POST', '/api/open-dir', {});
      t('POST /api/open-dir 空目录返回 400', r.status === 400, `status=${r.status}`);
    }

    console.log('  -- 工具默认目录设置 API --');
    {
      const r = await req('GET', '/api/settings');
      const j = JSON.parse(r.text);
      t('GET /api/settings 返回 ok 与 defaults', r.status === 200 && j.ok === true && 'tiktok' in j.defaults && 'bidding' in j.defaults);
      const p = await req('POST', '/api/settings', { tool: 'tiktok', dir: 'C:\\test\\dir' });
      const pj = JSON.parse(p.text);
      t('POST /api/settings 设置默认目录', p.status === 200 && pj.ok === true);
      const invalid = await req('POST', '/api/settings', { tool: 'xxx', dir: 'C:\\x' });
      t('POST /api/settings 非法工具返回 400', invalid.status === 400);
      const empty = await req('POST', '/api/settings', { tool: 'tiktok', dir: '  ' });
      t('POST /api/settings 空目录返回 400', empty.status === 400);
    }

    console.log('  -- 目录浏览 API --');
    {
      const r = await req('GET', '/api/browse');
      const j = JSON.parse(r.text);
      t('GET /api/browse 返回 ok 且含 dirs', r.status === 200 && j.ok === true && Array.isArray(j.dirs));
      const bad = await req('GET', '/api/browse?path=' + encodeURIComponent('Z:\\不存在的盘或目录\\x'));
      t('GET /api/browse 无效路径返回 400', bad.status === 400);
    }

    console.log('  -- 竞价导出 API --');
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
      const st = await req('GET', '/api/status');
      t('POST /api/cookie 后 loggedIn 为 true', JSON.parse(st.text).loggedIn === true, st.text);
    }
    {
      const r = await req('POST', '/api/export', { shopIds: [], dir: '' });
      t('POST /api/export 未选店铺返回 400', r.status === 400, `status=${r.status}`);
    }

    console.log('  -- 视频上传 API --');
    {
      const r = await req('GET', '/api/creds');
      t('GET /api/creds 返回 200 且含 sites', r.status === 200 && typeof JSON.parse(r.text).sites === 'object', r.text);
    }
    {
      // 模拟视频上传扩展推送凭证（按站点批量）
      const r = await req('POST', '/api/creds', {
        sites: {
          cn: { shops: { '557630453': { auth: 'NTAwMDcyMjU6dGVzdA==', cookie: 'video_upload_session_id=1; SPC_F=2' } } },
          ph: { auth: 'NTAwMDcyMjU6cGhwZXN0', cookie: 'x'.repeat(100), shopId: '888', userid: '12345' },
        },
      });
      t('POST /api/creds（扩展推送）返回 ok', r.status === 200 && JSON.parse(r.text).ok === true, r.text);
      const g = await req('GET', '/api/creds');
      const j = JSON.parse(g.text);
      t('POST /api/creds 后按店铺可读回', j.sites.cn.shops['557630453'] && j.sites.cn.shops['557630453'].auth.startsWith('NTAw'), g.text);
    }
    {
      const r = await req('POST', '/api/start', { site: 'cn', rows: [] });
      t('POST /api/start 空 rows 返回 400', r.status === 400, `status=${r.status}`);
      const bad = await fetch(BASE + '/api/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'not-json',
      });
      t('POST /api/start 非法 JSON 返回 400', bad.status === 400, `status=${bad.status}`);
    }
    {
      // 端到端 SSE：文件不存在 → row-error + finished（不触达真实网络）
      const r = await req('POST', '/api/start', {
        site: 'cn',
        rows: [{ path: 'Z:\\不存在的视频文件.mp4', caption: '', product: '' }],
      });
      const j = JSON.parse(r.text);
      t('POST /api/start 返回 jobId', r.status === 200 && typeof j.jobId === 'string' && j.jobId.length > 0, r.text);
      if (j.jobId) {
        const events = await readSSEUntil('/api/events?jobId=' + j.jobId, ['finished']);
        t('SSE 收到 connected 事件', events.some((e) => e.type === 'connected'));
        t('SSE 报告 1 个 row-error', events.filter((e) => e.type === 'row-error').length === 1, JSON.stringify(events));
        t('SSE 错误信息含文件不存在', events.some((e) => e.type === 'row-error' && e.error.includes('不存在')), JSON.stringify(events));
        t('SSE 收到 finished 事件', events.some((e) => e.type === 'finished'));
      }
    }
    {
      // SSE 连接即发 connected，然后断开
      const events = await readSSEUntil('/api/events?jobId=conn-test', ['connected']);
      t('GET /api/events 首事件为 connected', events.some((e) => e.type === 'connected'), JSON.stringify(events));
    }

    console.log('  -- 404 兜底 --');
    {
      const r = await req('GET', '/api/not-exist');
      t('GET /api/not-exist 返回 404', r.status === 404, `status=${r.status}`);
    }
  } finally {
    srv.stop();
  }
}

module.exports = { run };