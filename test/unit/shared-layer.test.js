'use strict';
// 单元测试：共享层契约（请求体解析 / 卖家中心 URL 拼接 / 导出工具 / 长任务 / 重试退避 /
// 路由分发兜底 / CORS 白名单）。对应三模块收敛后的公共契约。
const os = require('os');
const path = require('path');
const fs = require('fs');
const { t } = require('../helpers');
const { parseJsonText, readRouteBody, createDispatcher } = require('../../server/lib/http-utils');
const {
  buildShopeeUrl, DEFAULT_REGION, HOST, loadStoreNames, storeNameOf,
} = require('../../server/lib/shopee-session');
const { timestampText, ensureDir, defaultOutDir } = require('../../server/lib/export-utils');
const jobs = require('../../server/lib/jobs');
const {
  retry, exponentialBackoff, fixedBackoff, jitteredLinearBackoff,
} = require('../../server/lib/retry');
const { isAllowedOrigin } = require('../../server/main');

async function run() {
  // ===== 共享层：请求体解析 / 卖家中心 URL 拼接 / 导出工具（三模块收敛后的公共契约） =====
  {
    t('parseJsonText 容忍 UTF-8 BOM', parseJsonText('\uFEFF{"a":1}').a === 1 && parseJsonText('{"b":2}').b === 2);
    t('parseJsonText 非法 JSON 抛错', (() => {
      try { parseJsonText('not-json'); return false; } catch { return true; }
    })());

    const u = buildShopeeUrl('/api/mkt/buybox/update_enroll', {
      shopId: '100000001', region: 'ph', spcCds: 'abc123',
      business: { page_number: 1, page_size: 45, empty: '', nil: null },
    });
    t('buildShopeeUrl 拼接 HOST + 路径 + 公共参数',
      u.startsWith(`${HOST}/api/mkt/buybox/update_enroll?`) && u.includes('SPC_CDS_VER=2')
      && u.includes('SPC_CDS=abc123') && u.includes('cnsc_shop_id=100000001') && u.includes('cbsc_shop_region=ph'), u);
    t('buildShopeeUrl 带业务参数且跳过空值',
      u.includes('page_number=1') && u.includes('page_size=45') && !u.includes('empty=') && !u.includes('nil='), u);
    t('buildShopeeUrl 无 region 时不产出 cbsc_shop_region',
      !buildShopeeUrl('/api/v3/product/get_product_info', { shopId: '1', business: { product_id: 'x' } }).includes('cbsc_shop_region'));
    t('buildShopeeUrl 无 SPC_CDS 时跳过该参数', !buildShopeeUrl('/x', { shopId: '1' }).includes('SPC_CDS='));
    t('DEFAULT_REGION 与竞价系原兜底口径一致', DEFAULT_REGION === 'ph');

    // 店铺名映射（取代已删除的手工清单 config/stores.json）：
    // 只断言结构与回落语义，不断言具体店铺名——本文件读的是真实 openapi-session.json，
    // 用户新授权/改名不该让测试变红。
    t('loadStoreNames 返回对象（shopId -> name）', typeof loadStoreNames() === 'object' && loadStoreNames() !== null);
    t('storeNameOf 未知店铺回落为裸 shopId', storeNameOf('123456789', {}) === '123456789');
    t('storeNameOf 命中时返回店铺名', storeNameOf('1', { 1: '测试店铺' }) === '测试店铺');

    t('timestampText 形如 YYYY-MM-DD_HHmmss', /^\d{4}-\d{2}-\d{2}_\d{6}$/.test(timestampText(new Date(2026, 8, 11, 20, 5, 7))), timestampText());
    t('timestampText 补零', timestampText(new Date(2026, 0, 3, 4, 5, 6)) === '2026-01-03_040506', timestampText(new Date(2026, 0, 3, 4, 5, 6)));
    t('defaultOutDir 指向用户下载目录', defaultOutDir().endsWith('Downloads'), defaultOutDir());
    {
      const dir = path.join(os.tmpdir(), `kp_export_${Date.now()}`, 'a', 'b');
      try {
        t('ensureDir 递归创建目录', ensureDir(dir) === dir && fs.existsSync(dir));
        t('ensureDir 空入参回落默认下载目录', ensureDir('') === defaultOutDir());
      } finally {
        try { fs.rmSync(path.dirname(dir), { recursive: true, force: true }); } catch { /* 忽略 */ }
      }
    }
  }

  // ===== 共享层：长任务注册中心（暂停 / 继续 / 取消 / SSE 断开即取消） =====
  {
    const { CancelledError } = jobs;

    // 基本情况：创建后可查、finish 后消失
    const j1 = jobs.create();
    t('jobs：create 返回可查到的 jobId', typeof j1 === 'string' && j1.startsWith('job_') && jobs.has(j1));
    jobs.finish(j1);
    t('jobs：finish 后任务不可查', !jobs.has(j1) && jobs.get(j1) === undefined);

    // 未暂停 / 未取消 → checkpoint 直接放行
    const j2 = jobs.create();
    t('jobs：正常任务 checkpoint 放行', (await jobs.checkpoint(j2)) === true);
    jobs.finish(j2);

    // 暂停 → checkpoint 挂起；继续 → 放行（用 Promise.race 判定「确实挂起」）
    const j3 = jobs.create();
    t('jobs：setPaused 对存在的任务返回 true', jobs.setPaused(j3, true) === true);
    let resumed = false;
    const pending = jobs.checkpoint(j3).then(() => { resumed = true; });
    await new Promise((r) => setTimeout(r, 100));
    t('jobs：暂停时 checkpoint 挂起不返回', resumed === false);
    jobs.setPaused(j3, false);
    await pending;
    t('jobs：继续后 checkpoint 放行', resumed === true);
    jobs.finish(j3);

    // 取消 → checkpoint 抛 CancelledError 且带取消原因
    const j4 = jobs.create();
    jobs.cancel(j4, '用户取消');
    let err4 = null;
    try { await jobs.checkpoint(j4); } catch (e) { err4 = e; }
    t('jobs：取消后 checkpoint 抛 CancelledError', err4 instanceof CancelledError && err4.name === 'CancelledError', String(err4));
    t('jobs：取消原因可查询', jobs.cancelReason(j4) === '用户取消', jobs.cancelReason(j4));
    jobs.finish(j4);

    // SSE 客户端断开（isAborted）→ 视为取消，即使未显式 cancel
    const j5 = jobs.create();
    let err5 = null;
    try { await jobs.checkpoint(j5, () => true); } catch (e) { err5 = e; }
    t('jobs：SSE 断开时 checkpoint 抛 CancelledError', err5 instanceof CancelledError && err5.message.includes('SSE'), String(err5));
    jobs.finish(j5);

    // TTL 过期：巡检回收超时任务（执行体异常退出没走 finish 时的兜底）
    const { sweepJobs } = jobs._test;
    const j6 = jobs.create();
    jobs.get(j6).createdAt = Date.now() - jobs._ttlMs - 1;
    t('jobs：TTL 前任务可回收', sweepJobs() === 1 && !jobs.has(j6));
    const j8 = jobs.create();
    t('jobs：TTL 内任务不被误回收', sweepJobs() === 0 && jobs.has(j8));
    jobs.finish(j8);

    // 取消钩子：cancel 时调用一次
    let hooked = null;
    const j7 = jobs.create((reason) => { hooked = reason; });
    jobs.cancel(j7, '任务取消');
    t('jobs：cancel 触发 onCancel 钩子并传原因', hooked === '任务取消', String(hooked));
    jobs.finish(j7);

    // 对不存在的 jobId 的操作返回 false（路由据此回 404）
    t('jobs：不存在的 jobId setPaused/cancel 返回 false', jobs.setPaused('nope', true) === false && jobs.cancel('nope') === false);
  }

  // ===== 共享层：重试退避 =====
  {
    // 退避策略纯函数
    t('retry：指数退避 1s/2s/4s 且封顶', exponentialBackoff(1000, 8000)(1) === 1000 && exponentialBackoff(1000, 8000)(3) === 4000
      && exponentialBackoff(1000, 8000)(4) === 8000 && exponentialBackoff(1000, 8000)(9) === 8000);
    t('retry：固定退避恒为常量', fixedBackoff(1000)(1) === 1000 && fixedBackoff(1000)(7) === 1000);
    t('retry：抖动线性退避在 [step*n, step*n+jitter) 区间且离散',
      (() => {
        const f = jitteredLinearBackoff(3000, 2000);
        const seen = new Set();
        for (let i = 0; i < 20; i++) {
          const v = f(2);
          if (v < 6000 || v >= 8000) return false;
          seen.add(v);
        }
        return seen.size > 1; // 有抖动（非固定值）
      })());

    // 首次即成功：只调用一次
    let c1 = 0;
    const r1 = await retry(async () => { c1++; return 'ok'; }, { attempts: 3, waitOf: () => 0 });
    t('retry：成功即返回且只执行一次', r1 === 'ok' && c1 === 1);

    // 失败 attempts-1 次后成功
    let c2 = 0;
    const r2 = await retry(async () => {
      c2++;
      if (c2 < 3) throw new Error('boom');
      return 'late';
    }, { attempts: 3, waitOf: () => 0 });
    t('retry：按 attempts 上限重试后成功', r2 === 'late' && c2 === 3);

    // 次数耗尽 → 抛出最后一次错误
    let c3 = 0;
    let err3 = null;
    try {
      await retry(async () => { c3++; throw new Error('always-' + c3); }, { attempts: 3, waitOf: () => 0 });
    } catch (e) { err3 = e; }
    t('retry：次数耗尽抛最后一次错误', c3 === 3 && err3 && err3.message === 'always-3', String(err3));

    // shouldRetry=false → 不重试
    let c4 = 0;
    let err4 = null;
    try {
      await retry(async () => { c4++; throw new Error('业务错误'); }, { attempts: 5, waitOf: () => 0, shouldRetry: () => false });
    } catch (e) { err4 = e; }
    t('retry：shouldRetry 为 false 时立即抛出', c4 === 1 && err4 && err4.message === '业务错误');

    // isAborted → 不重试，原样抛出（取消不被误判为失败重试）
    let c5 = 0;
    let err5 = null;
    try {
      await retry(async () => { c5++; throw new Error('已取消'); }, { attempts: 5, waitOf: () => 0, isAborted: () => true });
    } catch (e) { err5 = e; }
    t('retry：isAborted 时不重试直接抛出', c5 === 1 && err5 && err5.message === '已取消');

    // onRetry 回调：次数与等待时长按策略计算
    const waits = [];
    let c6 = 0;
    try {
      await retry(async () => { c6++; throw new Error('x'); }, {
        attempts: 3, waitOf: fixedBackoff(5), onRetry: (e, attempt, waitMs) => waits.push([attempt, waitMs]),
      });
    } catch { /* 预期抛出 */ }
    t('retry：onRetry 按次回调并传退避时长', c6 === 3
      && JSON.stringify(waits) === JSON.stringify([[1, 5], [2, 5]]), JSON.stringify(waits));
  }

  // ===== 共享层：路由控制体解析（readRouteBody） =====
  {
    const { Readable } = require('stream');
    const bodyReq = (text) => {
      const r = new Readable({ read() {} });
      r.push(text);
      r.push(null);
      return r;
    };
    const fakeRes = () => {
      const r = { status: 0, body: '' };
      r.writeHead = (s) => { r.status = s; };
      r.end = (b) => { r.body = b || ''; };
      return r;
    };

    t('readRouteBody：合法 JSON 原样解析', (await readRouteBody(bodyReq('{"jobId":"a"}'))).jobId === 'a');
    const res400 = fakeRes();
    const bad = await readRouteBody(bodyReq('not-json'), '/api/x/pause', { res: res400 });
    t('readRouteBody：带 res 时非法 JSON 回 400 并返回 null', bad === null && res400.status === 400
      && JSON.parse(res400.body).ok === false, JSON.stringify({ status: res400.status, body: res400.body }));
    const soft = await readRouteBody(bodyReq('not-json'), '/api/x/pause');
    t('readRouteBody：不带 res 时非法 JSON 宽容返回 {}', soft && typeof soft === 'object' && Object.keys(soft).length === 0);
  }

  // ===== 共享层：CORS 白名单（main.js isAllowedOrigin） =====
  {
    t('CORS：本机 http/https（含任意端口）放行',
      isAllowedOrigin('http://127.0.0.1:8765') && isAllowedOrigin('http://localhost:5173')
      && isAllowedOrigin('https://127.0.0.1') && isAllowedOrigin('http://localhost'));
    t('CORS：浏览器扩展来源放行',
      isAllowedOrigin('chrome-extension://abcdefghijklmnop') && isAllowedOrigin('moz-extension://abcd1234'));
    t('CORS：外部网页来源拒绝（防 CSRF）',
      !isAllowedOrigin('http://evil.com') && !isAllowedOrigin('https://example.com')
      && !isAllowedOrigin('http://127.0.0.1.evil.com') && !isAllowedOrigin('http://localhost.evil.com'));
    t('CORS：空值 / 非字符串拒绝', !isAllowedOrigin('') && !isAllowedOrigin(undefined));
  }

  // ===== 全局：路由分发兜底（lib/http-utils.createDispatcher） =====
  {
    // 最小 res 双桩：记录 writeHead / end，模拟 headersSent
    function fakeRes() {
      const r = { headersSent: false, status: 0, body: '' };
      r.writeHead = (s) => { r.headersSent = true; r.status = s; };
      r.end = (b) => { r.body = b || ''; };
      return r;
    }
    const url = new URL('http://127.0.0.1/x');
    const settle = () => new Promise((r) => setTimeout(r, 10)); // 等待 Promise 微任务链

    t('分发：未命中路由返回 false', createDispatcher([])({ method: 'GET' }, fakeRes(), url) === false);

    const resSync = fakeRes();
    const hitSync = createDispatcher([{ m: 'GET', p: '/x', fn: () => { throw new Error('boom-sync'); } }])({ method: 'GET' }, resSync, url);
    await settle();
    const jSync = JSON.parse(resSync.body);
    t('分发：同步抛错兜底 500', hitSync === true && resSync.status === 500 && jSync.ok === false && resSync.body.includes('服务内部错误'), resSync.body);

    const resAsync = fakeRes();
    const hitAsync = createDispatcher([{ m: 'GET', p: '/x', fn: async () => { throw new Error('boom-async'); } }])({ method: 'GET' }, resAsync, url);
    await settle();
    t('分发：异步 reject 兜底 500', hitAsync === true && resAsync.status === 500 && JSON.parse(resAsync.body).ok === false, resAsync.body);

    // 已写响应头（模拟 SSE 流）后再抛错：不二次写响应，仅走 onError
    const resSse = fakeRes();
    let reported = null;
    const onError = (e, m, p) => { reported = { msg: e.message, m, p }; };
    const routesSse = [{ m: 'GET', p: '/x', fn: (req, res) => { res.writeHead(200); res.end(''); throw new Error('boom-sse'); } }];
    createDispatcher(routesSse, onError)({ method: 'GET' }, resSse, url);
    await settle();
    t('分发：已写响应头不二次响应（SSE）', resSse.status === 200 && resSse.body === '');
    t('分发：onError 上报方法与路径', reported && reported.msg === 'boom-sse' && reported.m === 'GET' && reported.p === '/x', JSON.stringify(reported));
  }
}

module.exports = { run };
