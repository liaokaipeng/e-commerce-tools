'use strict';
// 接口冒烟测试：临时端口 8865，不访问真实站点（TikTok/Shopee）。
// 只验证合并服务的路由、静态托管与本地逻辑；session 凭证文件测试前备份、结束后原样恢复。
const os = require('os');
const path = require('path');
const fs = require('fs');
const { BASE, ROOT, t, req, readSSEUntil, startServer, removeFile } = require('./helpers');

// 模拟视频扩展推送的凭证载荷（扩展对所有站点统一推 { shops: {...} }，见 extension/background.js push）
const CREDS_SEED = {
  sites: {
    cn: { shops: { '100000001': { auth: 'NTAwMDcyMjU6dGVzdA==', cookie: 'video_upload_session_id=1; SPC_F=2' } } },
    ph: { shops: { '888': { auth: 'NTAwMDcyMjU6cGhwZXN0', cookie: 'x'.repeat(100), userid: '12345' } } },
  },
};

// 发送任意原始请求体（验「非法 JSON 应显式 400」用，req() 只能发合法 JSON）
async function rawPost(urlPath, raw) {
  const r = await fetch(BASE + urlPath, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: raw,
  });
  const text = await r.text();
  return { status: r.status, text, get json() { return JSON.parse(text); } };
}

// 批量任务两模块共用的「未选店铺 400」断言族（preview + run 各一条，不减断言）
async function expectBatch400(prefix) {
  const p = await req('POST', `${prefix}/preview`, { shopIds: [] });
  t(`POST ${prefix}/preview 未选店铺返回 400`, p.status === 400, `status=${p.status}`);
  const r = await req('POST', `${prefix}/run`, { shopIds: [] });
  t(`POST ${prefix}/run 未选店铺返回 400`, r.status === 400, `status=${r.status}`);
}

// 批量任务控制端点（pause/resume/cancel）对不存在 jobId 的 404 断言族
async function expectJobControl404(prefix) {
  for (const act of ['pause', 'resume', 'cancel']) {
    const r = await req('POST', `${prefix}/${act}`, { jobId: 'job_not_exist' });
    t(`POST ${prefix}/${act} 无效 jobId 返回 404`, r.status === 404, `status=${r.status}`);
  }
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
    for (const p of ['/', '/tiktok/', '/bidding/', '/bidding-cancel/', '/hotlisting-cancel/', '/return-whs/', '/video/', '/video/?mode=cn', '/video/?mode=ph', '/openapi/', '/monitor/', '/xlsx.full.min.js']) {
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
        const j = r.json;
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
      const j = r.json;
      t('GET /api/settings 返回 ok 与 defaults', r.status === 200 && j.ok === true && 'tiktok' in j.defaults && 'bidding' in j.defaults);
      const p = await req('POST', '/api/settings', { tool: 'tiktok', dir: 'C:\\test\\dir' });
      const pj = p.json;
      t('POST /api/settings 设置默认目录', p.status === 200 && pj.ok === true);
      const invalid = await req('POST', '/api/settings', { tool: 'xxx', dir: 'C:\\x' });
      t('POST /api/settings 非法工具返回 400', invalid.status === 400);
      const empty = await req('POST', '/api/settings', { tool: 'tiktok', dir: '  ' });
      t('POST /api/settings 空目录返回 400', empty.status === 400);
    }

    console.log('  -- 目录浏览 API --');
    {
      const r = await req('GET', '/api/browse');
      const j = r.json;
      t('GET /api/browse 返回 ok 且含 dirs', r.status === 200 && j.ok === true && Array.isArray(j.dirs));
      const bad = await req('GET', '/api/browse?path=' + encodeURIComponent('Z:\\不存在的盘或目录\\x'));
      t('GET /api/browse 无效路径返回 400', bad.status === 400);
    }

    console.log('  -- 竞价导出 API --');
    {
      const r = await req('GET', '/api/status');
      t('GET /api/status 返回 200', r.status === 200, r.text);
      if (r.status === 200) t('/api/status 含 loggedIn 字段', 'loggedIn' in r.json);
    }
    {
      // 手工店铺清单 config/stores.json 已删除：列表统一由 /api/openapi/stores 提供，旧路由下线
      const r = await req('GET', '/api/stores');
      t('GET /api/stores（已下线）返回 404', r.status === 404, `status=${r.status}`);
    }
    {
      // 模拟竞价扩展推送 Cookie
      const r = await req('POST', '/api/cookie', {
        savedAt: new Date().toISOString(),
        cookies: [{ name: 'SPC_F', value: 'test', domain: 'seller.shopee.cn', path: '/', httpOnly: true }],
      });
      t('POST /api/cookie（扩展推送）返回 ok', r.text === 'ok', r.text);
      const st = await req('GET', '/api/status');
      t('POST /api/cookie 后 loggedIn 为 true', st.json.loggedIn === true, st.text);
    }
    {
      const r = await req('POST', '/api/export', { shopIds: [], dir: '' });
      t('POST /api/export 未选店铺返回 400', r.status === 400, `status=${r.status}`);
    }

    console.log('  -- 取消竞价 API --');
    {
      await expectBatch400('/api/bidding-cancel');
    }
    {
      // 无登录会话时返回友好提示，不触达真实站点（helpers.stop 会按备份恢复会话文件）
      const sess = path.join(ROOT, 'server', 'data', 'bidding-session.json');
      removeFile(sess);
      const r = await req('POST', '/api/bidding-cancel/preview', { shopIds: ['953673451'] });
      t('无登录 Cookie 时 preview 返回 400 且提示 Cookie', r.status === 400 && r.json.msg.includes('Cookie'), r.text);
      // run 为 SSE 接口：无会话时广播 fatal 事件后断开
      const events = await readSSEUntil('/api/bidding-cancel/run', [], {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shopIds: ['953673451'] }),
      });
      t('无登录 Cookie 时 run 广播 fatal 事件', events.some((e) => e.type === 'fatal'), JSON.stringify(events));
    }

    console.log('  -- 获取退单仓库 API --');
    {
      // 缺店铺ID / 无有效 Return ID / 超行数上限：显式 400，均不触达开放平台网关
      const r1 = await req('POST', '/api/return-whs/run', { rows: [{ rowIndex: 1, returnId: 'RTN12345TEST0001' }] });
      t('POST /api/return-whs/run 行缺店铺ID 返回 400', r1.status === 400 && r1.json.msg.includes('店铺ID'), r1.text);
      const r2 = await req('POST', '/api/return-whs/run', { rows: [] });
      t('POST /api/return-whs/run 无有效 Return ID 返回 400', r2.status === 400 && r2.json.msg.includes('Return ID'), r2.text);
      const big = Array.from({ length: 2001 }, (_, i) => ({ rowIndex: i + 1, returnId: 'R' + i, shopId: '953673451' }));
      const r3 = await req('POST', '/api/return-whs/run', { rows: big });
      t('POST /api/return-whs/run 超过行数上限返回 400', r3.status === 400, `status=${r3.status}`);
      // 暂停/继续/取消：不存在的 jobId 返回 404；非法 JSON 显式 400（与其它批量任务同一语义）
      const p1 = await req('POST', '/api/return-whs/pause', { jobId: 'job_not_exist' });
      t('POST /api/return-whs/pause 无效 jobId 返回 404', p1.status === 404, `status=${p1.status}`);
      const p4 = await rawPost('/api/return-whs/pause', 'not-json');
      t('POST /api/return-whs/pause 非法 JSON 返回 400', p4.status === 400, `status=${p4.status}`);
    }

    console.log('  -- 取消注册 Hot Listing API --');
    {
      // SPU 配置读取/保存
      const c1 = await req('GET', '/api/hotlisting-cancel/spu-config');
      t('GET /api/hotlisting-cancel/spu-config 返回 200', c1.status === 200 && c1.json.ok === true, c1.text);
      const c2 = await req('POST', '/api/hotlisting-cancel/spu-config', { map: { 953673451: '42555837160\n123' } });
      t('POST spu-config 保存成功并归一化', c2.status === 200 && c2.json.map['953673451'] === '42555837160\n123', c2.text);
      const c3 = await req('GET', '/api/hotlisting-cancel/spu-config');
      t('保存后可读回', c3.json.map['953673451'] === '42555837160\n123', c3.text);
      // 清理（保存空 map），避免影响后续用例
      await req('POST', '/api/hotlisting-cancel/spu-config', { map: {} });

      await expectBatch400('/api/hotlisting-cancel');
      // 有店铺但未配置 SPU（请求体空 map 即「清空也生效」语义）
      const r3 = await req('POST', '/api/hotlisting-cancel/preview', { shopIds: ['953673451'], spuMap: {} });
      t('preview 无 SPU 配置返回 400', r3.status === 400 && r3.json.msg.includes('SPU'), r3.text);
      // 无登录会话（上一用例已删除 bidding-session.json）：返回友好提示，不触达真实站点
      const r4 = await req('POST', '/api/hotlisting-cancel/preview', { shopIds: ['953673451'], spuMap: { 953673451: '42555837160' } });
      t('无登录 Cookie 时 preview 返回 400 且提示 Cookie', r4.status === 400 && r4.json.msg.includes('Cookie'), r4.text);
      // 暂停/继续/取消：不存在的 jobId 返回 404
      await expectJobControl404('/api/hotlisting-cancel');
      // 控制类接口把 body 当必需指令：非法 JSON 必须显式 400，不能静默当参数缺失
      const p4 = await rawPost('/api/hotlisting-cancel/pause', 'not-json');
      t('POST pause 非法 JSON 返回 400', p4.status === 400, `status=${p4.status} ${p4.text}`);
      const p5 = await rawPost('/api/bidding-cancel/pause', 'not-json');
      t('POST bidding-cancel/pause 非法 JSON 返回 400', p5.status === 400, `status=${p5.status} ${p5.text}`);
      // 取消竞价控制端点：同样要求给出 jobId（任务不存在 → 404，而非 500）
      await expectJobControl404('/api/bidding-cancel');

      // CORS 白名单：外部网页来源直接被拒（防本机写接口被 CSRF）
      const cors = await fetch(BASE + '/api/status', { headers: { Origin: 'http://evil.example.com' } });
      t('CORS：非白名单 Origin 请求被拒 403', cors.status === 403, `status=${cors.status}`);
      const corsOk = await fetch(BASE + '/api/status', { headers: { Origin: 'http://127.0.0.1:5173' } });
      t('CORS：本机来源放行并回显 Origin',
        corsOk.status === 200 && corsOk.headers.get('access-control-allow-origin') === 'http://127.0.0.1:5173',
        `${corsOk.status} ${corsOk.headers.get('access-control-allow-origin')}`);

      const resp = await readSSEUntil('/api/hotlisting-cancel/run', [], {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shopIds: ['953673451'], spuMap: { 953673451: '42555837160' } }),
      });
      t('无登录 Cookie 时 run 广播 fatal 事件', resp.some((e) => e.type === 'fatal'), JSON.stringify(resp));
    }

    console.log('  -- 视频上传 API --');
    {
      const r = await req('GET', '/api/creds');
      t('GET /api/creds 返回 200 且含 sites', r.status === 200 && typeof r.json.sites === 'object', r.text);
    }
    {
      // 模拟视频上传扩展推送凭证（按站点批量）
      const r = await req('POST', '/api/creds', CREDS_SEED);
      t('POST /api/creds（扩展推送）返回 ok', r.status === 200 && r.json.ok === true, r.text);
      const g = await req('GET', '/api/creds');
      const j = g.json;
      t('POST /api/creds 后按店铺可读回', j.sites.cn.shops['100000001'] && j.sites.cn.shops['100000001'].auth.startsWith('NTAw'), g.text);
      t('扩展 shops 格式的 ph 凭证归一化为扁平存储', j.sites.ph && j.sites.ph.auth === 'NTAwMDcyMjU6cGhwZXN0' && String(j.sites.ph.shopId) === '888' && j.sites.ph.userid === '12345', g.text);
    }
    {
      // 跨境无 shopId 的扁平推送必须被拒绝：若落入扁平分支会把 { shops } 整个覆盖，全部店铺凭证丢失
      const r = await req('POST', '/api/creds', { site: 'cn', auth: 'NTAwMDcyMjU6eA==', cookie: 'x'.repeat(100) });
      t('POST /api/creds 跨境缺 shopId 返回 400', r.status === 400, `status=${r.status} ${r.text}`);
      const g = await req('GET', '/api/creds');
      const j = g.json;
      t('被拒绝的推送不破坏已有跨境店铺凭证', !!(j.sites.cn && j.sites.cn.shops && j.sites.cn.shops['100000001']), g.text);
    }
    {
      const r = await req('POST', '/api/start', { site: 'cn', rows: [] });
      t('POST /api/start 空 rows 返回 400', r.status === 400, `status=${r.status}`);
      const bad = await rawPost('/api/start', 'not-json');
      t('POST /api/start 非法 JSON 返回 400', bad.status === 400, `status=${bad.status}`);
    }
    {
      // 端到端 SSE：文件不存在 → row-error + finished（不触达真实网络）
      const r = await req('POST', '/api/start', {
        site: 'cn',
        rows: [{ path: 'Z:\\不存在的视频文件.mp4', caption: '', product: '' }],
      });
      const j = r.json;
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
      // 端到端 SSE：商品编码为空 → 跳过上传，row-error 带 skip 标记（前端状态列显示「失败，商品为空」）
      const tmp = path.join(os.tmpdir(), `kp_skip_${Date.now()}.mp4`);
      fs.writeFileSync(tmp, 'x');
      try {
        const r = await req('POST', '/api/start', { site: 'cn', rows: [{ path: tmp, caption: '', product: '' }] });
        const j = r.json;
        if (j.jobId) {
          const events = await readSSEUntil('/api/events?jobId=' + j.jobId, ['finished']);
          t('商品为空行跳过：row-error 带 skip 标记且错误含「商品」',
            events.some((e) => e.type === 'row-error' && e.skip === true && /商品/.test(e.error)),
            JSON.stringify(events));
          t('商品为空行跳过后任务正常收尾 finished', events.some((e) => e.type === 'finished'));
        }
      } finally {
        removeFile(tmp);
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
      // 行必须带商品编码——商品编码为空会在流式哈希前被「商品为空」秒跳过，任务瞬间结束，取消无法稳定到达；
      // 取消后任务在下一行停止，SSE（含迟到回放）应收到 cancelled 而非 finished。
      const tmp = path.join(os.tmpdir(), `kp_cancel_${Date.now()}.mp4`);
      const fd = fs.openSync(tmp, 'w');
      fs.ftruncateSync(fd, 20 * 1024 * 1024);
      fs.closeSync(fd);
      try {
        const rows = Array.from({ length: 3 }, () => ({ path: tmp, caption: '', product: '123' }));
        const r = await req('POST', '/api/start', { site: 'cn', rows });
        const { jobId } = r.json;
        const c = await fetch(BASE + '/api/cancel', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jobId }) });
        const cj = await c.json();
        t('POST /api/cancel 取消进行中任务返回 ok', cj.ok === true, JSON.stringify(cj));
        if (jobId && cj.ok) {
          const events = await readSSEUntil('/api/events?jobId=' + jobId, ['cancelled', 'finished']);
          t('取消后 SSE 收到 cancelled（而非 finished）', events.some((e) => e.type === 'cancelled'), JSON.stringify(events.slice(-3)));
        }
      } finally {
        removeFile(tmp);
      }
    }

    console.log('  -- 开放平台登录 API --');
    {
      // 测试服务用独立临时会话文件启动（helpers.startServer 设 OPENAPI_SESSION_FILE），
      // 不触碰用户真实 openapi-session.json，本组断言从「未配置」状态开始。
      const r = await req('GET', '/api/openapi/status');
      const j = r.json;
      t('GET /api/openapi/status 返回 200', r.status === 200 && j.ok === true, r.text);
      t('未配置 App 时 status 为未配置且无店铺', j.configured === false && Array.isArray(j.shops) && j.shops.length === 0, r.text);

      const au = await req('POST', '/api/openapi/auth-url', { redirect: '' });
      t('未配置 App 时生成授权链接返回 400', au.status === 400 && au.json.ok === false, au.text);
      const auBad = await req('POST', '/api/openapi/auth-url', { redirect: 'http://1.2.3.4/x' });
      t('非本机 IP redirect 返回 400', auBad.status === 400 && auBad.json.message.includes('本机可达地址'), auBad.text);
      const auLocal = await req('POST', '/api/openapi/auth-url', { redirect: 'http://127.0.0.1.sslip.io:8765/openapi/callback' });
      t('本机域名 redirect 通过校验（未配置 App 时 400 且不触网）', auLocal.status === 400 && auLocal.json.message.includes('App'), auLocal.text);
      const auManual = await req('POST', '/api/openapi/auth-url', { redirect: 'https://my.example.com/cb' });
      t('https 域名 redirect 通过校验走手动模式（未配置 App 时 400 且不触网）', auManual.status === 400 && auManual.json.message.includes('App'), auManual.text);
      const auManualHttp = await req('POST', '/api/openapi/auth-url', { redirect: 'http://my.example.com/cb' });
      t('http 自有域名 redirect 同样走手动模式', auManualHttp.status === 400 && auManualHttp.json.message.includes('App'), auManualHttp.text);
      const ac = await req('POST', '/api/openapi/auth-callback', { code: '', shopId: '' });
      t('auth-callback 缺授权码返回 400', ac.status === 400 && ac.json.message.includes('code'), ac.text);
      const ac2 = await req('POST', '/api/openapi/auth-callback', { code: 'x' });
      t('auth-callback 有 code 但无 shop_id/main_account_id 返回 400', ac2.status === 400 && ac2.json.message.includes('main_account_id'), ac2.text);
      const rf = await req('POST', '/api/openapi/refresh', { shopId: '123' });
      t('未配置 App 时刷新返回 400', rf.status === 400 && rf.json.message.includes('App'), rf.text);
      const ts = await req('POST', '/api/openapi/test', { shopId: '123' });
      t('未配置 App 时测试返回 400', ts.status === 400 && ts.json.message.includes('App'), ts.text);

      const saveBad = await req('POST', '/api/openapi/app', { partnerId: 'p123', partnerKey: '', env: 'prod' });
      t('保存 App 缺 partner_key 返回 400', saveBad.status === 400, saveBad.text);
      const saveEnv = await req('POST', '/api/openapi/app', { partnerId: 'p123', partnerKey: 'k456', env: 'xx' });
      t('保存 App 非法环境返回 400', saveEnv.status === 400, saveEnv.text);

      const save = await req('POST', '/api/openapi/app', { partnerId: 'p123', partnerKey: 'k456', env: 'prod' });
      const sj = save.json;
      t('保存 App 返回 ok 且 key 打码', save.status === 200 && sj.ok === true && sj.partnerKeyMasked.includes('***') && !save.text.includes('k456'), save.text);

      const st = await req('GET', '/api/openapi/status');
      const stj = st.json;
      t('保存后 status 已配置且不泄漏完整 key', stj.configured === true && stj.partnerId === 'p123' && stj.partnerKeyMasked.includes('***') && !st.text.includes('k456'), st.text);

      // 授权链接为本地拼接的 GET URL（auth_partner 不发起接口调用），不触达真实站点
      const g = await req('POST', '/api/openapi/auth-url', { redirect: 'http://127.0.0.1.sslip.io:8765/openapi/callback' });
      const gj = g.json;
      t('生成授权链接返回 authUrl（本地拼接 GET URL，不触网）', g.status === 200 && gj.ok === true && typeof gj.authUrl === 'string' && gj.authUrl.startsWith('https://partner.shopeemobile.com/api/v2/shop/auth_partner?') && gj.authUrl.includes('partner_id=p123') && gj.authUrl.includes('redirect='), g.text);
      t('本机域名授权链接 mode=auto', gj.mode === 'auto', g.text);
      const gm = await req('POST', '/api/openapi/auth-url', { redirect: 'https://my.example.com/cb' });
      const gmj = gm.json;
      t('自有域名授权链接 mode=manual', gm.status === 200 && gmj.ok === true && gmj.mode === 'manual' && gmj.authUrl.includes('redirect='), gm.text);

      const rm = await req('POST', '/api/openapi/remove-shop', { shopId: '999' });
      t('删除不存在的店铺幂等返回 ok', rm.status === 200 && rm.json.ok === true && rm.json.removed === false, rm.text);
      const rf2 = await req('POST', '/api/openapi/refresh', { shopId: '999' });
      t('店铺未授权时刷新返回 400', rf2.status === 400 && rf2.json.message.includes('尚未授权'), rf2.text);
      const ts2 = await req('POST', '/api/openapi/test', { shopId: '999' });
      t('店铺未授权时测试返回 400（不触达真实站点）', ts2.status === 400 && ts2.json.message.includes('尚未授权'), ts2.text);

      const cb = await req('GET', '/openapi/callback');
      t('GET /openapi/callback 返回 200 且含中文提示', cb.status === 200 && cb.text.includes('正在完成店铺授权'), `status=${cb.status}`);
    }

    console.log('  -- 监控大屏 API --');
    {
      // 测试服务未授权任何店铺：调度器空转、不触达真实站点；监控数据目录已隔离（helpers.startServer）
      const ov = await req('GET', '/api/monitor/overview');
      const ovj = ov.json;
      t('GET /api/monitor/overview 返回 200 且结构完整', ov.status === 200 && ovj.ok === true && Array.isArray(ovj.shops) && ovj.shops.length === 0 && ovj.totals.P0 === 0 && 'configured' in ovj && 'excludedCount' in ovj && ovj.excludedCount === 0, ov.text);
      t('GET /api/monitor/overview metrics 含新增域指标', ovj.metrics && ovj.metrics['ads.balance'] && ovj.metrics['funds.pending_txn'] && ovj.metrics['aftersale.returns_24h'] && ovj.metrics['health.punishments'], JSON.stringify(Object.keys(ovj.metrics || {})));
      const al = await req('GET', '/api/monitor/alerts');
      t('GET /api/monitor/alerts 返回空列表', al.status === 200 && al.json.ok === true && al.json.alerts.length === 0, al.text);
      const ru = await req('GET', '/api/monitor/rules');
      const ruj = ru.json;
      t('GET /api/monitor/rules 返回默认规则', ru.status === 200 && ruj.ok === true && Array.isArray(ruj.rules) && ruj.rules.length >= 11, ru.text);
      t('GET /api/monitor/rules 包含新增域规则', ruj.rules.some((r) => r.id === 'ads.balance') && ruj.rules.some((r) => r.id === 'aftersale.negative_24h') && ruj.rules.some((r) => r.id === 'funds.pending_txn') && ruj.rules.some((r) => r.id === 'health.punishments'), ruj.rules.map((r) => r.id).join(','));
      const tr = await req('GET', '/api/monitor/trend?shopId=x&metric=order.pending_24h&days=7');
      const trj = tr.json;
      t('GET /api/monitor/trend 无数据返回空点集', tr.status === 200 && trj.ok === true && Array.isArray(trj.points) && trj.points.length === 0 && trj.metric.id === 'order.pending_24h', tr.text);
      const trBad = await req('GET', '/api/monitor/trend?shopId=x');
      t('GET /api/monitor/trend 缺 metric 返回 400', trBad.status === 400, `status=${trBad.status}`);
      const rs = await req('GET', '/api/monitor/rule-suggestions?days=30');
      const rsj = rs.json;
      t('GET /api/monitor/rule-suggestions 返回 200 且结构完整', rs.status === 200 && rsj.ok === true && rsj.suggest && rsj.suggest['order.pending_24h'] && typeof rsj.suggest['order.pending_24h'].samples === 'number' && rsj.suggest['order.pending_24h'].suggest === null && rsj.suggest['system.collect_fail'] === undefined, rs.text);
      const col = await req('POST', '/api/monitor/collect', {});
      t('无授权店铺时手动采集返回 400', col.status === 400 && col.json.message.includes('店铺'), col.text);
      const act = await req('POST', '/api/monitor/alert-action', { id: 'x', action: 'delete' });
      t('删除不存在的告警返回 400', act.status === 400, act.text);
      const bact = await req('POST', '/api/monitor/alert-action', { ids: ['x', 'y'], action: 'delete' });
      t('POST /api/monitor/alert-action 批量删除缺告警返回 400', bact.status === 400, bact.text);
      const bactBad = await req('POST', '/api/monitor/alert-action', { ids: ['x'], action: 'nope' });
      t('POST /api/monitor/alert-action 非法 action 返回 400', bactBad.status === 400, bactBad.text);
      const bactNoAct = await req('POST', '/api/monitor/alert-action', { ids: ['x'] });
      t('POST /api/monitor/alert-action 缺 action 返回 400', bactNoAct.status === 400, bactNoAct.text);
      const rb = await req('POST', '/api/monitor/rules', { overrides: { 'unknown.rule': { enabled: false } } });
      t('POST /api/monitor/rules 未知规则返回 400', rb.status === 400, rb.text);
      const rw = await req('POST', '/api/monitor/rules', { overrides: { 'order.pending_24h': { thresholds: { p2: 5 } } } });
      const rwj = rw.json;
      t('POST /api/monitor/rules 覆盖阈值生效', rw.status === 200 && rwj.ok === true && rwj.rules.find((r) => r.id === 'order.pending_24h').thresholds.p2 === 5, rw.text);
      const rwBlank = await req('POST', '/api/monitor/rules', { overrides: { 'order.pending_24h': { thresholds: { p2: null } } } });
      const rwBlankJ = rwBlank.json;
      t('POST /api/monitor/rules 阈值送 null 删除该级别（面板留空 = 不触发）', rwBlank.status === 200 && rwBlankJ.ok === true && rwBlankJ.rules.find((r) => r.id === 'order.pending_24h').thresholds.p2 === undefined, rwBlank.text);
      const rwReset = await req('POST', '/api/monitor/rules', { overrides: {} });
      const rwResetJ = rwReset.json;
      t('POST /api/monitor/rules 清空覆盖还原默认', rwReset.status === 200 && rwResetJ.rules.find((r) => r.id === 'order.pending_24h').thresholds.p2 === 3, rwReset.text);
      // 监控店铺配置
      const scg = await req('GET', '/api/monitor/shops-config');
      const scgj = scg.json;
      t('GET /api/monitor/shops-config 返回 200 且结构完整', scg.status === 200 && scgj.ok === true && Array.isArray(scgj.shops) && 'configured' in scgj, scg.text);
      const scpBad = await req('POST', '/api/monitor/shops-config', { excludedShopIds: 'x' });
      t('POST /api/monitor/shops-config 非数组返回 400', scpBad.status === 400, scpBad.text);
      const scp = await req('POST', '/api/monitor/shops-config', { excludedShopIds: ['123', 456] });
      const scpj = scp.json;
      t('POST /api/monitor/shops-config 保存排除名单（数字转字符串）', scp.status === 200 && scpj.ok === true && scpj.excludedShopIds.includes('456'), scp.text);
      const scg2 = (await req('GET', '/api/monitor/shops-config')).json;
      t('配置保存后 GET 可见且默认无店铺（未授权）', scg2.ok === true && scg2.shops.length === 0, JSON.stringify(scg2));
      const scpReset = await req('POST', '/api/monitor/shops-config', { excludedShopIds: [] });
      t('POST /api/monitor/shops-config 清空排除名单恢复默认', scpReset.status === 200 && scpReset.json.ok === true, scpReset.text);
      // 金额单位模式（阈值口径固定人民币；展示模式全局切换，默认当地货币）
      const cg = await req('GET', '/api/monitor/currency-config');
      const cgj = cg.json;
      t('GET /api/monitor/currency-config 默认当地货币', cg.status === 200 && cgj.ok === true && cgj.mode === 'local', cg.text);
      const cbBad = await req('POST', '/api/monitor/currency-config', { mode: 'usd' });
      t('POST /api/monitor/currency-config 非法模式返回 400', cbBad.status === 400, cbBad.text);
      const cb = await req('POST', '/api/monitor/currency-config', { mode: 'rmb' });
      const cbj = cb.json;
      t('POST /api/monitor/currency-config 切换人民币生效', cb.status === 200 && cbj.ok === true && cbj.mode === 'rmb', cb.text);
      const ovCur = (await req('GET', '/api/monitor/overview')).json;
      t('GET /api/monitor/overview 透出 currencyMode', ovCur.currencyMode === 'rmb');
      const cbReset = await req('POST', '/api/monitor/currency-config', { mode: 'local' });
      t('POST /api/monitor/currency-config 还原当地货币', cbReset.status === 200 && cbReset.json.mode === 'local', cbReset.text);
      const stt = await req('GET', '/api/monitor/status');
      const sttj = stt.json;
      t('GET /api/monitor/status 返回运行状态', stt.status === 200 && sttj.ok === true && sttj.running === true && Array.isArray(sttj.shops) && sttj.shops.length === 0, stt.text);
      // 按需采集：在场心跳 / 离开事件
      const pOn = await req('POST', '/api/monitor/presence', { active: true });
      const pOnJ = pOn.json;
      t('POST /api/monitor/presence 在场返回 ok 且 active=true', pOn.status === 200 && pOnJ.ok === true && pOnJ.active === true, pOn.text);
      const sttOn = (await req('GET', '/api/monitor/status')).json;
      t('在场后 status.presenceActive=true 且含租约时长', sttOn.presenceActive === true && typeof sttOn.presenceLeaseMs === 'number' && sttOn.presenceLeaseMs > 0, JSON.stringify({ presenceActive: sttOn.presenceActive, presenceLeaseMs: sttOn.presenceLeaseMs }));
      const pOff = await req('POST', '/api/monitor/presence', { active: false });
      const pOffJ = pOff.json;
      t('POST /api/monitor/presence 离开返回 ok 且 active=false', pOff.status === 200 && pOffJ.ok === true && pOffJ.active === false, pOff.text);
      const sttOff = (await req('GET', '/api/monitor/status')).json;
      t('离开后 status.presenceActive=false', sttOff.presenceActive === false, JSON.stringify({ presenceActive: sttOff.presenceActive }));
      const pBad = await req('POST', '/api/monitor/presence', {});
      t('POST /api/monitor/presence 缺 active 字段视为离开（不报错）', pBad.status === 200 && pBad.json.ok === true, pBad.text);
      const events = await readSSEUntil('/api/monitor/events', ['connected']);
      t('GET /api/monitor/events 首事件为 connected', events.some((e) => e.type === 'connected'), JSON.stringify(events));
    }

    console.log('  -- 缓存清理 API --');
    {
      // 服务端凭证文件测试前后均由 helpers 备份/恢复，这里可放心清。
      // 造数据：先推送视频凭证，确保「清空后为空」断言有意义
      const seed = await req('POST', '/api/creds', CREDS_SEED);
      t('POST /api/creds 造凭证数据（前置）', seed.status === 200 && seed.json.ok === true, seed.text);

      const list = await req('GET', '/api/cache');
      const lj = list.json;
      const ids = (lj.categories || []).map((c) => c.id).join(',');
      t('GET /api/cache 返回四类缓存', list.status === 200 && lj.ok === true
        && lj.categories.length === 4
        && ['video', 'bidding', 'openapi', 'monitor'].every((x) => ids.includes(x))
        && lj.categories.every((c) => typeof c.info === 'string'), list.text);

      const bad = await req('POST', '/api/cache/clear', { category: 'nope' });
      t('POST /api/cache/clear 未知类别返回 400', bad.status === 400, `status=${bad.status} ${bad.text}`);

      const cv = await req('POST', '/api/cache/clear', { category: 'video' });
      const cvj = cv.json;
      t('清空视频上传凭证返回 ok', cv.status === 200 && cvj.ok === true, cv.text);
      const g = (await req('GET', '/api/creds')).json;
      const videoEmpty = !g.sites || Object.keys(g.sites).length === 0
        || (!g.sites.cn && !g.sites.ph)
        || (!((g.sites.cn && g.sites.cn.shops && Object.keys(g.sites.cn.shops).length) || (g.sites.ph && (g.sites.ph.auth || g.sites.ph.cookie))));
      t('清空后 /api/creds 无任何凭证', videoEmpty, JSON.stringify(g));
      const videoInfo = (await req('GET', '/api/cache')).json.categories.find((c) => c.id === 'video');
      t('video 类别 info 反映已清空', videoInfo.info.includes('0 个店铺') && videoInfo.info.includes('无凭证'), videoInfo.info);

      const cb = await req('POST', '/api/cache/clear', { category: 'bidding' });
      t('清空竞价登录 Cookie 返回 ok', cb.status === 200 && cb.json.ok === true, cb.text);
      t('清空后 bidding-session.json 已删除', !fs.existsSync(path.join(ROOT, 'server', 'data', 'bidding-session.json')));

      const co = await req('POST', '/api/cache/clear', { category: 'openapi' });
      t('清空开放平台店铺 Token 返回 ok', co.status === 200 && co.json.ok === true, co.text);

      const cm = await req('POST', '/api/cache/clear', { category: 'monitor' });
      t('清空监控数据返回 ok', cm.status === 200 && cm.json.ok === true, cm.text);
      const al = (await req('GET', '/api/monitor/alerts')).json;
      t('清空监控后告警列表为空', al.ok === true && al.alerts.length === 0, JSON.stringify(al));

      const empty = await req('POST', '/api/cache/clear', {});
      t('POST /api/cache/clear 缺类别返回 400', empty.status === 400, `status=${empty.status}`);
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