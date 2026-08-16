'use strict';
// 接口冒烟测试：临时端口 8865，不访问真实站点（TikTok/Shopee）。
// 只验证合并服务的路由、静态托管与本地逻辑；session 凭证文件测试前备份、结束后原样恢复。
const os = require('os');
const path = require('path');
const fs = require('fs');
const { BASE, ROOT, t, req, startServer } = require('./helpers');

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
    for (const p of ['/', '/tiktok/', '/bidding/', '/bidding-cancel/', '/video/', '/video/?mode=cn', '/video/?mode=ph', '/openapi/', '/monitor/', '/xlsx.full.min.js']) {
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

    console.log('  -- 取消竞价 API --');
    {
      const r = await req('POST', '/api/bidding-cancel/preview', { shopIds: [] });
      t('POST /api/bidding-cancel/preview 未选店铺返回 400', r.status === 400, `status=${r.status}`);
      const r2 = await req('POST', '/api/bidding-cancel/run', { shopIds: [] });
      t('POST /api/bidding-cancel/run 未选店铺返回 400', r2.status === 400, `status=${r2.status}`);
    }
    {
      // 无登录会话时返回友好提示，不触达真实站点（helpers.stop 会按备份恢复会话文件）
      const sess = path.join(ROOT, 'server', 'data', 'bidding-session.json');
      if (fs.existsSync(sess)) fs.unlinkSync(sess);
      const r = await req('POST', '/api/bidding-cancel/preview', { shopIds: ['953673451'] });
      t('无登录 Cookie 时 preview 返回 400 且提示 Cookie', r.status === 400 && JSON.parse(r.text).msg.includes('Cookie'), r.text);
      // run 为 SSE 接口：无会话时广播 fatal 事件后断开
      const resp = await fetch(BASE + '/api/bidding-cancel/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shopIds: ['953673451'] }),
      });
      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      const events = [];
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const parts = buf.split('\n\n');
        buf = parts.pop();
        for (const part of parts) {
          const line = part.split('\n').find((l) => l.startsWith('data: '));
          if (!line) continue;
          try { events.push(JSON.parse(line.slice(6))); } catch { /* 忽略无法解析的事件 */ }
        }
      }
      t('无登录 Cookie 时 run 广播 fatal 事件', events.some((e) => e.type === 'fatal'), JSON.stringify(events));
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

    console.log('  -- 任务取消 API --');
    {
      const miss = await fetch(BASE + '/api/cancel', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
      t('POST /api/cancel 缺 jobId 返回 400', miss.status === 400, `status=${miss.status}`);
      const notFound = await fetch(BASE + '/api/cancel', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jobId: 'no-such-job' }) });
      const nfText = await notFound.text();
      t('POST /api/cancel 不存在任务返回 404', notFound.status === 404 && JSON.parse(nfText).ok === false, `status=${notFound.status} ${nfText}`);
    }
    {
      // 取消进行中任务：行指向真实存在的 20MB 稀疏文件，每行流式哈希耗时足以让 cancel 稳定到达；
      // 取消后任务在下一行停止，SSE（含迟到回放）应收到 cancelled 而非 finished。
      const tmp = path.join(os.tmpdir(), `kp_cancel_${Date.now()}.mp4`);
      const fd = fs.openSync(tmp, 'w');
      fs.ftruncateSync(fd, 20 * 1024 * 1024);
      fs.closeSync(fd);
      try {
        const rows = Array.from({ length: 3 }, () => ({ path: tmp, caption: '', product: '' }));
        const r = await req('POST', '/api/start', { site: 'cn', rows });
        const { jobId } = JSON.parse(r.text);
        const c = await fetch(BASE + '/api/cancel', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jobId }) });
        const cj = await c.json();
        t('POST /api/cancel 取消进行中任务返回 ok', cj.ok === true, JSON.stringify(cj));
        if (jobId && cj.ok) {
          const events = await readSSEUntil('/api/events?jobId=' + jobId, ['cancelled', 'finished']);
          t('取消后 SSE 收到 cancelled（而非 finished）', events.some((e) => e.type === 'cancelled'), JSON.stringify(events.slice(-3)));
        }
      } finally {
        fs.unlinkSync(tmp);
      }
    }

    console.log('  -- 开放平台登录 API --');
    {
      // 测试服务用独立临时会话文件启动（helpers.startServer 设 OPENAPI_SESSION_FILE），
      // 不触碰用户真实 openapi-session.json，本组断言从「未配置」状态开始。
      const r = await req('GET', '/api/openapi/status');
      const j = JSON.parse(r.text);
      t('GET /api/openapi/status 返回 200', r.status === 200 && j.ok === true, r.text);
      t('未配置 App 时 status 为未配置且无店铺', j.configured === false && Array.isArray(j.shops) && j.shops.length === 0, r.text);

      const au = await req('POST', '/api/openapi/auth-url', { redirect: '' });
      t('未配置 App 时生成授权链接返回 400', au.status === 400 && JSON.parse(au.text).ok === false, au.text);
      const auBad = await req('POST', '/api/openapi/auth-url', { redirect: 'http://1.2.3.4/x' });
      t('非本机 IP redirect 返回 400', auBad.status === 400 && JSON.parse(auBad.text).message.includes('本机可达地址'), auBad.text);
      const auLocal = await req('POST', '/api/openapi/auth-url', { redirect: 'http://127.0.0.1.sslip.io:8765/openapi/callback' });
      t('本机域名 redirect 通过校验（未配置 App 时 400 且不触网）', auLocal.status === 400 && JSON.parse(auLocal.text).message.includes('App'), auLocal.text);
      const auManual = await req('POST', '/api/openapi/auth-url', { redirect: 'https://my.example.com/cb' });
      t('https 域名 redirect 通过校验走手动模式（未配置 App 时 400 且不触网）', auManual.status === 400 && JSON.parse(auManual.text).message.includes('App'), auManual.text);
      const auManualHttp = await req('POST', '/api/openapi/auth-url', { redirect: 'http://my.example.com/cb' });
      t('http 自有域名 redirect 同样走手动模式', auManualHttp.status === 400 && JSON.parse(auManualHttp.text).message.includes('App'), auManualHttp.text);
      const ac = await req('POST', '/api/openapi/auth-callback', { code: '', shopId: '' });
      t('auth-callback 缺授权码返回 400', ac.status === 400 && JSON.parse(ac.text).message.includes('code'), ac.text);
      const ac2 = await req('POST', '/api/openapi/auth-callback', { code: 'x' });
      t('auth-callback 有 code 但无 shop_id/main_account_id 返回 400', ac2.status === 400 && JSON.parse(ac2.text).message.includes('main_account_id'), ac2.text);
      const rf = await req('POST', '/api/openapi/refresh', { shopId: '123' });
      t('未配置 App 时刷新返回 400', rf.status === 400 && JSON.parse(rf.text).message.includes('App'), rf.text);
      const ts = await req('POST', '/api/openapi/test', { shopId: '123' });
      t('未配置 App 时测试返回 400', ts.status === 400 && JSON.parse(ts.text).message.includes('App'), ts.text);

      const saveBad = await req('POST', '/api/openapi/app', { partnerId: 'p123', partnerKey: '', env: 'prod' });
      t('保存 App 缺 partner_key 返回 400', saveBad.status === 400, saveBad.text);
      const saveEnv = await req('POST', '/api/openapi/app', { partnerId: 'p123', partnerKey: 'k456', env: 'xx' });
      t('保存 App 非法环境返回 400', saveEnv.status === 400, saveEnv.text);

      const save = await req('POST', '/api/openapi/app', { partnerId: 'p123', partnerKey: 'k456', env: 'prod' });
      const sj = JSON.parse(save.text);
      t('保存 App 返回 ok 且 key 打码', save.status === 200 && sj.ok === true && sj.partnerKeyMasked.includes('***') && !save.text.includes('k456'), save.text);

      const st = await req('GET', '/api/openapi/status');
      const stj = JSON.parse(st.text);
      t('保存后 status 已配置且不泄漏完整 key', stj.configured === true && stj.partnerId === 'p123' && stj.partnerKeyMasked.includes('***') && !st.text.includes('k456'), st.text);

      // 授权链接为本地拼接的 GET URL（auth_partner 不发起接口调用），不触达真实站点
      const g = await req('POST', '/api/openapi/auth-url', { redirect: 'http://127.0.0.1.sslip.io:8765/openapi/callback' });
      const gj = JSON.parse(g.text);
      t('生成授权链接返回 authUrl（本地拼接 GET URL，不触网）', g.status === 200 && gj.ok === true && typeof gj.authUrl === 'string' && gj.authUrl.startsWith('https://partner.shopeemobile.com/api/v2/shop/auth_partner?') && gj.authUrl.includes('partner_id=p123') && gj.authUrl.includes('redirect='), g.text);
      t('本机域名授权链接 mode=auto', gj.mode === 'auto', g.text);
      const gm = await req('POST', '/api/openapi/auth-url', { redirect: 'https://my.example.com/cb' });
      const gmj = JSON.parse(gm.text);
      t('自有域名授权链接 mode=manual', gm.status === 200 && gmj.ok === true && gmj.mode === 'manual' && gmj.authUrl.includes('redirect='), gm.text);

      const rm = await req('POST', '/api/openapi/remove-shop', { shopId: '999' });
      t('删除不存在的店铺幂等返回 ok', rm.status === 200 && JSON.parse(rm.text).ok === true && JSON.parse(rm.text).removed === false, rm.text);
      const rf2 = await req('POST', '/api/openapi/refresh', { shopId: '999' });
      t('店铺未授权时刷新返回 400', rf2.status === 400 && JSON.parse(rf2.text).message.includes('尚未授权'), rf2.text);
      const ts2 = await req('POST', '/api/openapi/test', { shopId: '999' });
      t('店铺未授权时测试返回 400（不触达真实站点）', ts2.status === 400 && JSON.parse(ts2.text).message.includes('尚未授权'), ts2.text);

      const cb = await req('GET', '/openapi/callback');
      t('GET /openapi/callback 返回 200 且含中文提示', cb.status === 200 && cb.text.includes('正在完成店铺授权'), `status=${cb.status}`);
    }

    console.log('  -- 监控大屏 API --');
    {
      // 测试服务未授权任何店铺：调度器空转、不触达真实站点；监控数据目录已隔离（helpers.startServer）
      const ov = await req('GET', '/api/monitor/overview');
      const ovj = JSON.parse(ov.text);
      t('GET /api/monitor/overview 返回 200 且结构完整', ov.status === 200 && ovj.ok === true && Array.isArray(ovj.shops) && ovj.shops.length === 0 && ovj.totals.P0 === 0 && 'configured' in ovj, ov.text);
      const al = await req('GET', '/api/monitor/alerts');
      t('GET /api/monitor/alerts 返回空列表', al.status === 200 && JSON.parse(al.text).ok === true && JSON.parse(al.text).alerts.length === 0, al.text);
      const ru = await req('GET', '/api/monitor/rules');
      const ruj = JSON.parse(ru.text);
      t('GET /api/monitor/rules 返回默认规则', ru.status === 200 && ruj.ok === true && Array.isArray(ruj.rules) && ruj.rules.length >= 11, ru.text);
      const tr = await req('GET', '/api/monitor/trend?shopId=x&metric=order.pending_24h&days=7');
      const trj = JSON.parse(tr.text);
      t('GET /api/monitor/trend 无数据返回空点集', tr.status === 200 && trj.ok === true && Array.isArray(trj.points) && trj.points.length === 0 && trj.metric.id === 'order.pending_24h', tr.text);
      const trBad = await req('GET', '/api/monitor/trend?shopId=x');
      t('GET /api/monitor/trend 缺 metric 返回 400', trBad.status === 400, `status=${trBad.status}`);
      const col = await req('POST', '/api/monitor/collect', {});
      t('无授权店铺时手动采集返回 400', col.status === 400 && JSON.parse(col.text).message.includes('店铺'), col.text);
      const act = await req('POST', '/api/monitor/alert-action', { id: 'x', action: 'ack' });
      t('不存在的告警操作返回 400', act.status === 400, act.text);
      const rb = await req('POST', '/api/monitor/rules', { overrides: { 'unknown.rule': { enabled: false } } });
      t('POST /api/monitor/rules 未知规则返回 400', rb.status === 400, rb.text);
      const rw = await req('POST', '/api/monitor/rules', { overrides: { 'order.pending_24h': { thresholds: { p2: 5 } } } });
      const rwj = JSON.parse(rw.text);
      t('POST /api/monitor/rules 覆盖阈值生效', rw.status === 200 && rwj.ok === true && rwj.rules.find((r) => r.id === 'order.pending_24h').thresholds.p2 === 5, rw.text);
      const rwReset = await req('POST', '/api/monitor/rules', { overrides: {} });
      const rwResetJ = JSON.parse(rwReset.text);
      t('POST /api/monitor/rules 清空覆盖还原默认', rwReset.status === 200 && rwResetJ.rules.find((r) => r.id === 'order.pending_24h').thresholds.p2 === 3, rwReset.text);
      const stt = await req('GET', '/api/monitor/status');
      const sttj = JSON.parse(stt.text);
      t('GET /api/monitor/status 返回运行状态', stt.status === 200 && sttj.ok === true && sttj.running === true && Array.isArray(sttj.shops) && sttj.shops.length === 0, stt.text);
      const events = await readSSEUntil('/api/monitor/events', ['connected']);
      t('GET /api/monitor/events 首事件为 connected', events.some((e) => e.type === 'connected'), JSON.stringify(events));
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