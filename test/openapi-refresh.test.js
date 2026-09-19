'use strict';
// 开放平台「店铺授权 + token 刷新」链路测试（离线，不依赖真实网关）。
//
// 手法：替换 server/lib/http 的 request 为 mock 网关（模拟官方「旧 refresh_token 调用后立即作废」语义），
//      并把凭证文件隔离到临时路径——必须在 require store/client 之前设 OPENAPI_SESSION_FILE **并清 require 缓存**，
//      否则会命中 unit.test.js 已加载的旧实例（指向用户真实 server/data/openapi-session.json）。
// 覆盖（均对应真实修过的缺陷）：
//   1. 共享 token 组的手动刷新必须整组续期（单店刷新会作废同组其它店铺的 refresh_token）
//   2. 独立凭证按 shop_id 刷新、不跨店传播
//   3. 认证类失败重试必须**真的强制刷新**（token 名义未过期时旧逻辑会复用同一个 token，白跑一次就标失效）
//   4. 并发强制刷新同一店铺只发一次网关请求（per-shop 锁）
//   5. 路由 /api/openapi/refresh 返回整组续期结果；失效店铺不进「选择店铺」列表
//   5b. 重点店铺标记（/api/openapi/shop-important）：写标记 / 计数 / status 回显 / 非法入参 400
//   6. 换 partner_id 清空旧凭证；非数字 id 明确报错；响应载荷层解析口径统一
//   7. 批量刷新（/api/openapi/refresh-all/run）按共享 token 分组去重：3 店共享组只发一次网关请求，
//      失效店铺整组跳过且不被误标恢复
//   8. 手动刷新冷却（刚刷过不重复请求网关，但不拦截 callOpenApi 的认证失败强制刷新）与批量刷新单飞互斥
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Readable } = require('stream');
const { t, removeFile } = require('./helpers');

const SESSION_FILE = path.join(os.tmpdir(), `kp_openapi_refresh_${process.pid}_${Date.now()}.json`);
process.env.OPENAPI_SESSION_FILE = SESSION_FILE;

// ---------- mock 网关（必须在 require client/store 之前替换） ----------
const httpLib = require('../server/lib/http');
const origRequest = httpLib.request;
const gw = { revoked: new Set(), seq: 0, bizFail: 0, calls: [] };
// 测试用闸门：置 on 后刷新请求会挂起，直到 waiters 被逐个放行（用于验证批量刷新单飞互斥）
const gwHold = { on: false, waiters: [] };
const okJson = (json) => ({ status: 200, json, text: '' });
const PARTNER_RE = /partner\.(?:test-stable\.)?shopeemobile\.com/;

httpLib.request = async (opts) => {
  const url = String(opts.url || '');
  if (!PARTNER_RE.test(url)) return origRequest(opts); // 非网关请求原样转发，行为不变
  const body = opts.body ? JSON.parse(opts.body) : null;
  const apiPath = url.replace(/^https:\/\/[^/]+/, '').split('?')[0];
  gw.calls.push({ apiPath, body });
  if (apiPath === '/api/v2/auth/access_token/get') {
    if (gwHold.on) await new Promise((resolve) => gwHold.waiters.push(resolve)); // 卡住响应
    const rt = body && body.refresh_token;
    if (!rt || gw.revoked.has(rt)) {
      return okJson({ error: 'error_auth', message: 'Your refresh token or shop_id is wrong' });
    }
    gw.revoked.add(rt); // 官方语义：旧 refresh_token 调用后立即失效
    gw.seq += 1;
    return okJson({ access_token: 'AT' + gw.seq, refresh_token: 'RT' + gw.seq, expire_in: 14400 });
  }
  if (apiPath === '/api/v2/auth/token/get') {
    return okJson({
      access_token: 'ATX', refresh_token: 'RTX', expire_in: 14400,
      shop_id_list: [111, 222, 333], merchant_id_list: [9001],
    });
  }
  if (apiPath === '/api/v2/shop/get_shop_info') {
    if (gw.bizFail > 0) { gw.bizFail -= 1; return okJson({ error: 'error_auth', message: 'Invalid access_token' }); }
    return okJson({ shop_name: '测试店铺', region: 'SG' });
  }
  return okJson({});
};

// 路由里的 notifyAuthChanged 不该把整条监控链路拉起来（未加载时才预置 mock）
const schedPath = require.resolve('../server/monitor/scheduler');
if (!require.cache[schedPath]) {
  require.cache[schedPath] = { id: schedPath, filename: schedPath, loaded: true, exports: { notifyAuthChanged() {} } };
}

// 清掉可能的旧实例，让 store 以临时凭证文件重新加载。
// ⚠️ openapi.js 里 require 的**每个**子模块都要列进来（新增子模块时同步补）：
// 这些子模块在 unit.test.js 阶段就已随 openapi.js 加载过，内部持有的 store 指向**真实**
// openapi-session.json、持有的 http.request 是 mock 替换**之前**解构的原始实现。
// 漏清缓存 → 命中旧实例 → 测试会真的向 Shopee 网关发刷新请求并把结果写回用户真实凭证文件。
for (const p of [
  '../server/openapi/store',
  '../server/openapi/client',
  '../server/openapi',
  '../server/openapi/refresh-all',
  '../server/openapi/redirect',
  '../server/openapi/stores-view',
  '../server/openapi/callback-page',
  '../server/openapi/notify',
]) {
  delete require.cache[require.resolve(p)];
}
const store = require('../server/openapi/store');
const client = require('../server/openapi/client');
const openapi = require('../server/openapi');

// ---------- 路由 handler 收集（无需起服务） ----------
const routes = {};
openapi.register({ get: (p, h) => { routes['GET ' + p] = h; }, post: (p, h) => { routes['POST ' + p] = h; } });

function fakeReq(obj) {
  return Readable.from([Buffer.from(JSON.stringify(obj))]);
}
function fakeRes() {
  const res = {
    headersSent: false, status: 0, data: null, ended: false, chunks: [],
    writeHead(s) { this.status = s; this.headersSent = true; },
    // SSE 帧收集（批量刷新走流式接口）
    write(c) { this.chunks.push(String(c)); return true; },
    on() {},
    end(str) {
      if (str !== undefined) { try { this.data = JSON.parse(str); } catch { this.data = str; } }
      this.ended = true;
      if (res._endResolve) res._endResolve();
    },
  };
  res.endPromise = new Promise((r) => { res._endResolve = r; });
  return res;
}
async function callRoute(key, body) {
  const res = fakeRes();
  await routes[key](fakeReq(body), res);
  return res;
}
/** 解析 SSE 响应体收集到的事件列表（丢掉 retry 帧） */
function sseEvents(res) {
  return res.chunks
    .join('')
    .split('\n\n')
    .filter((part) => part.startsWith('data: '))
    .map((part) => JSON.parse(part.slice(6)));
}

const NOW = Math.floor(Date.now() / 1000);
const REFRESH_PATH = '/api/v2/auth/access_token/get';

/** 重置凭证状态：清空店铺 + 以固定 App 配置重建给定店铺（默认 token 未过期） */
function reset(shops) {
  store.clearShops();
  store.setApp({ partnerId: '1234567', partnerKey: 'secret-key', env: 'prod' });
  gw.calls.length = 0;
  gw.revoked.clear();
  gw.seq = 0;
  gw.bizFail = 0;
  gwHold.on = false;
  gwHold.waiters.length = 0;
  for (const s of shops) {
    store.setShop('prod', s.shopId, Object.assign({
      merchantId: '', accessToken: 'OLD_AT', refreshToken: 'R', accessExpireAt: NOW + 3600,
    }, s));
  }
}

async function cases() {
  console.log('  -- 开放平台刷新链路（离线 mock 网关） --');

  // 1) 共享 token 组的手动刷新必须整组续期
  reset([
    { shopId: '111', merchantId: '9001' },
    { shopId: '222', merchantId: '9001' },
    { shopId: '333', merchantId: '9001' },
  ]);
  const r1 = await client.refreshShopNow('prod', '111');
  const c1 = gw.calls.filter((c) => c.apiPath === REFRESH_PATH);
  t('共享 token 组手动刷新走 merchant_id 整组刷新（不是 shop_id）',
    c1.length === 1 && c1[0].body.merchant_id === 9001 && c1[0].body.shop_id === undefined,
    JSON.stringify(c1));
  const after1 = store.getShopsRaw('prod');
  t('整组续期：三店同时换到同一新 refresh_token',
    after1.length === 3 && after1.every((s) => s.refreshToken === 'RT1'),
    after1.map((s) => `${s.shopId}:${s.refreshToken}`).join(' '));
  t('整组续期后没有被误标「需重新授权」的店铺',
    after1.every((s) => !s.invalid),
    after1.map((s) => `${s.shopId}:${s.invalid}`).join(' '));
  t('refreshShopNow 返回 synced=3 / mode=group-merchant',
    r1.synced === 3 && r1.mode === 'group-merchant',
    JSON.stringify({ synced: r1.synced, mode: r1.mode }));

  // 2) 独立凭证按店铺刷新，不跨店传播
  reset([{ shopId: '111' }, { shopId: '222' }]);
  store.setShop('prod', '222', { refreshToken: 'R2' });
  const r2 = await client.refreshShopNow('prod', '111');
  const c2 = gw.calls.filter((c) => c.apiPath === REFRESH_PATH);
  t('独立凭证按 shop_id 刷新', c2.length === 1 && c2[0].body.shop_id === 111, JSON.stringify(c2));
  t('独立凭证刷新只写回本店（其余店铺 token 不动）',
    r2.synced === 1 && store.getShop('prod', '111').refreshToken === 'RT1' && store.getShop('prod', '222').refreshToken === 'R2');

  // 3) 认证类失败重试必须真的强制刷新（token 名义未过期也要刷）
  reset([{ shopId: '999' }]);
  gw.bizFail = 1;
  let retryOk = false;
  try {
    await client.callOpenApi('/api/v2/shop/get_shop_info', {}, { shopId: '999', method: 'GET' });
    retryOk = true;
  } catch { /* 下面断言失败原因 */ }
  t('认证失败后强制刷新并重试成功（未过期 token 也会真刷新）',
    retryOk && gw.calls.some((c) => c.apiPath === REFRESH_PATH),
    gw.calls.map((c) => c.apiPath).join(' → '));
  t('重试成功后店铺未被标记「需重新授权」', store.getShop('prod', '999').invalid !== true);

  // 4) 并发强制刷新同一店铺只发一次网关请求
  reset([{ shopId: '555' }]);
  await Promise.all([client.refreshShopNow('prod', '555'), client.refreshShopNow('prod', '555')]);
  t('并发强制刷新同一店铺只发一次网关请求',
    gw.calls.filter((c) => c.apiPath === REFRESH_PATH).length === 1,
    gw.calls.map((c) => c.apiPath).join(' → '));

  // 5) 路由层：整组续期结果透出 / 失效店铺不进「选择店铺」列表
  reset([{ shopId: '111', merchantId: '9001' }, { shopId: '222', merchantId: '9001' }]);
  const res5 = await callRoute('POST /api/openapi/refresh', { shopId: '111' });
  t('POST /api/openapi/refresh 返回 syncedShops=2 / mode=group-merchant',
    res5.status === 200 && res5.data.ok === true && res5.data.syncedShops === 2 && res5.data.mode === 'group-merchant',
    JSON.stringify(res5.data));
  t('刷新提示文案包含同组店铺数量',
    typeof res5.data.message === 'string' && res5.data.message.includes('2'),
    res5.data.message);

  reset([{ shopId: '111' }, { shopId: '222' }]);
  store.markShopInvalid('prod', '222', '测试：凭证无效');
  const res6 = await callRoute('GET /api/openapi/stores', {});
  const ids6 = (Array.isArray(res6.data) ? res6.data : []).map((s) => s.id);
  t('失效店铺不出现在 /api/openapi/stores 选择列表',
    ids6.includes('111') && !ids6.includes('222'),
    JSON.stringify(res6.data));
  t('status 仍保留失效店铺（大屏「待重新授权」依赖它）',
    store.status().shops.some((s) => s.shopId === '222' && s.state === 're_auth'));

  // 5b) 重点店铺标记：写标记 / 计数 / status 回显 / 非法入参
  reset([{ shopId: '111' }, { shopId: '222' }, { shopId: '333' }]);
  const imp1 = await callRoute('POST /api/openapi/shop-important', { shopId: '111', important: true });
  t('POST /api/openapi/shop-important 标记重点店铺成功且计数正确',
    imp1.status === 200 && imp1.data.ok === true && imp1.data.important === true && imp1.data.importantCount === 1,
    JSON.stringify(imp1.data));
  await callRoute('POST /api/openapi/shop-important', { shopId: '333', important: true });
  t('getImportantIds 返回全部重点店铺 ID',
    store.getImportantIds('prod').slice().sort().join(',') === '111,333',
    JSON.stringify(store.getImportantIds('prod')));
  t('status 每条店铺带 important 字段（供页面回显）',
    store.status().shops.find((s) => s.shopId === '111').important === true
      && store.status().shops.find((s) => s.shopId === '222').important === false);
  const impOff = await callRoute('POST /api/openapi/shop-important', { shopId: '111', important: false });
  t('取消重点标记后计数减少',
    impOff.status === 200 && impOff.data.important === false && impOff.data.importantCount === 1,
    JSON.stringify(impOff.data));
  const impBad = await callRoute('POST /api/openapi/shop-important', { shopId: '999', important: true });
  t('对未授权店铺标记重点返回 400',
    impBad.status === 400 && impBad.data.ok === false, JSON.stringify(impBad.data));
  const impNone = await callRoute('POST /api/openapi/shop-important', {});
  t('shop-important 缺少 shop_id 返回 400', impNone.status === 400, JSON.stringify(impNone.data));

  // 6) 换 App 清空旧凭证 / 非数字 id 报错 / 载荷层解析口径统一
  reset([{ shopId: '111' }]);
  const saved = store.setApp({ partnerId: '7654321', partnerKey: 'k2', env: 'prod' });
  t('换 partner_id 时清空该环境旧店铺凭证',
    saved.shopsCleared === true && store.getShopsRaw('prod').length === 0);
  const saved2 = store.setApp({ partnerId: '7654321', partnerKey: 'k3', env: 'prod' });
  t('同一 partner_id 重复保存不清空凭证', saved2.shopsCleared === false);

  reset([
    { shopId: '111', merchantId: 'M-非数字' },
    { shopId: '222', merchantId: 'M-非数字' },
  ]);
  let msg8 = '';
  try { await client.refreshShopNow('prod', '111'); } catch (e) { msg8 = e.message; }
  t('非数字 merchant_id 明确报错（不再静默发出 merchant_id:null）',
    msg8.includes('merchant_id') && msg8.includes('非数字'),
    msg8);

  t('pickPayload 兼容包在 response 层的响应',
    client.pickPayload({ response: { access_token: 'a', refresh_token: 'b' } }, ['access_token']).access_token === 'a');
  const tk = await client.exchangeToken('prod', { code: 'C', mainAccountId: 'M' });
  t('exchangeToken 解析 shop_id_list / merchant_id_list',
    tk.authorizedShopIds.join(',') === '111,222,333' && tk.merchantId === '9001',
    JSON.stringify({ shops: tk.authorizedShopIds, merchantId: tk.merchantId }));

  // 7) 批量刷新：按共享 token 分组去重（逐店刷新会作废同组凭证）
  reset([
    { shopId: '111', merchantId: '9001' },
    { shopId: '222', merchantId: '9001' },
    { shopId: '333', merchantId: '9001' },
    { shopId: '444', refreshToken: 'R444' },
  ]);
  const resAll = await callRoute('POST /api/openapi/refresh-all/run', {});
  await resAll.endPromise;
  const evs = sseEvents(resAll);
  const refreshCalls = gw.calls.filter((c) => c.apiPath === REFRESH_PATH);
  t('批量刷新：共享组只刷一次（3 店 1 组）+ 独立店铺一次 = 共 2 次网关请求',
    refreshCalls.length === 2 && refreshCalls.filter((c) => c.body.merchant_id === 9001).length === 1,
    JSON.stringify(refreshCalls.map((c) => c.body)));
  t('批量刷新 start 事件带 jobId 与总组数',
    evs[0].type === 'start' && !!evs[0].jobId && evs[0].totalGroups === 2 && evs[0].totalShops === 4,
    JSON.stringify(evs[0]));
  const gd = evs.filter((e) => e.type === 'group-done');
  t('批量刷新：两组都成功且各自带回 synced',
    gd.length === 2 && gd.every((e) => e.ok === true) && gd.reduce((n, e) => n + e.synced, 0) === 4,
    JSON.stringify(gd));
  const afterAll = store.getShopsRaw('prod');
  t('批量刷新后四店 token 全部续期（共享组同一新 token）',
    afterAll.length === 4 && afterAll.filter((s) => ['111', '222', '333'].includes(s.shopId)).every((s) => s.refreshToken === 'RT1')
      && afterAll.find((s) => s.shopId === '444').refreshToken === 'RT2',
    afterAll.map((s) => `${s.shopId}:${s.refreshToken}`).join(' '));
  const sum7 = evs.find((e) => e.type === 'summary');
  t('批量刷新 summary 统计：2 组成功 / 4 个店铺续期 / 0 失败 0 跳过',
    !!sum7 && sum7.refreshed === 2 && sum7.synced === 4 && sum7.failed === 0 && sum7.skipped === 0,
    JSON.stringify(sum7));

  // 8) 批量刷新：失效店铺被跳过，不发网关请求、不被误标「已恢复」
  reset([{ shopId: '111' }, { shopId: '222', refreshToken: 'R2' }]);
  store.markShopInvalid('prod', '222', '测试：凭证无效');
  const resSkip = await callRoute('POST /api/openapi/refresh-all/run', {});
  await resSkip.endPromise;
  const evsSkip = sseEvents(resSkip);
  const sk = evsSkip.find((e) => e.type === 'skipped');
  t('批量刷新：失效店铺跳过且不触达网关',
    !!sk && sk.shopIds.join(',') === '222'
      && gw.calls.filter((c) => c.apiPath === REFRESH_PATH).length === 1,
    JSON.stringify({ skipped: sk, calls: gw.calls.length }));
  t('批量刷新 summary 体现跳过数',
    evsSkip.some((e) => e.type === 'summary' && e.refreshed === 1 && e.skipped === 1),
    JSON.stringify(evsSkip.find((e) => e.type === 'summary')));
  t('批量刷新不会把失效店铺当成「已恢复」', store.getShop('prod', '222').invalid === true);

  // 9) planRefreshGroups 纯函数：分组与跳过语义
  const { planRefreshGroups } = require('../server/openapi/refresh-all');
  const pg = planRefreshGroups([
    { shopId: '3', refreshToken: 'A', merchantId: 'M1' },
    { shopId: '1', refreshToken: 'A', merchantId: 'M1' },
    { shopId: '2', refreshToken: 'B', merchantId: 'M1' },
    { shopId: '4', refreshToken: 'C', merchantId: '' },
    { shopId: '5', refreshToken: 'C', merchantId: '' },
    { shopId: '6', refreshToken: '' },
  ]);
  t('planRefreshGroups：共享 token 归一组、代表取最小 shopId、mode=group-merchant',
    pg.groups.length === 2 && pg.groups[0].repShopId === '1' && pg.groups[0].shopIds.join(',') === '1,3'
      && pg.groups[0].mode === 'group-merchant' && pg.groups[0].size === 2,
    JSON.stringify(pg.groups));
  t('planRefreshGroups：共享无 merchant_id 的组与缺 refresh_token 的店铺都进跳过',
    pg.skipped.length === 2 && pg.skipped.some((s) => s.shopIds.join(',') === '4,5')
      && pg.skipped.some((s) => s.shopIds.join(',') === '6'),
    JSON.stringify(pg.skipped));

  // 10) 手动刷新冷却：刚刷过再点不重复请求网关（防连点把刚轮换的凭证刷死 → 整组被判需重新授权）
  reset([{ shopId: '111', merchantId: '9001' }, { shopId: '222', merchantId: '9001' }]);
  await client.refreshShopNow('prod', '111');
  const callsAfterFirst = gw.calls.filter((c) => c.apiPath === REFRESH_PATH).length;
  const cool = await client.refreshShopNow('prod', '111');
  t('冷却期内重复手动刷新不重复请求网关（mode=cooldown / synced=0）',
    cool.mode === 'cooldown' && cool.synced === 0
      && gw.calls.filter((c) => c.apiPath === REFRESH_PATH).length === callsAfterFirst,
    JSON.stringify({ mode: cool.mode, synced: cool.synced, calls: gw.calls.length }));
  t('冷却未把店铺标记「需重新授权」', store.getShopsRaw('prod').every((s) => !s.invalid));
  store.setShop('prod', '111', { refreshedAt: 0 }); // 老数据无冷却基准 → 应照常真刷新
  const cool2 = await client.refreshShopNow('prod', '111');
  t('无 refreshedAt（老数据）不受冷却拦截，仍真刷新整组',
    cool2.mode === 'group-merchant' && cool2.synced === 2,
    JSON.stringify({ mode: cool2.mode, synced: cool2.synced }));

  // 11) 冷却只作用于手动/批量入口：callOpenApi 的认证失败重试必须仍真刷新（否则坏 token 被复用、白标失效）
  reset([{ shopId: '888' }]);
  store.setShop('prod', '888', { refreshedAt: Date.now() }); // 处于冷却窗口内
  gw.bizFail = 1;
  let retryOk2 = false;
  try {
    await client.callOpenApi('/api/v2/shop/get_shop_info', {}, { shopId: '888', method: 'GET' });
    retryOk2 = true;
  } catch { /* 断言见下 */ }
  t('冷却不拦截 callOpenApi 的认证失败强制刷新（坏 token 必须真换）',
    retryOk2 && gw.calls.some((c) => c.apiPath === REFRESH_PATH),
    gw.calls.map((c) => c.apiPath).join(' → '));
  t('强制重试成功后店铺未被标记「需重新授权」', store.getShop('prod', '888').invalid !== true);

  // 12) 批量刷新单飞：任务进行中再触发被 409 拒绝，结束后互斥释放、可再次发起
  reset([{ shopId: '111', merchantId: '9001' }, { shopId: '222', merchantId: '9001' }]);
  gwHold.on = true; // 卡住第一组的网关响应，让任务停留在「进行中」
  const runA = await callRoute('POST /api/openapi/refresh-all/run', {});
  const runB = await callRoute('POST /api/openapi/refresh-all/run', {});
  t('批量刷新单飞：进行中再触发返回 409（不启动第二套刷新）',
    runB.status === 409 && runB.data && runB.data.ok === false,
    JSON.stringify({ status: runB.status, data: runB.data }));
  gwHold.on = false;
  gwHold.waiters.splice(0).forEach((f) => f());
  await runA.endPromise;
  const evsA = sseEvents(runA);
  t('批量刷新单飞：被放行的任务正常收尾',
    evsA.some((e) => e.type === 'summary'),
    JSON.stringify(evsA.map((e) => e.type)));
  const callsBeforeC = gw.calls.filter((c) => c.apiPath === REFRESH_PATH).length;
  const runC = await callRoute('POST /api/openapi/refresh-all/run', {});
  await runC.endPromise;
  const evsC = sseEvents(runC);
  t('批量刷新互斥释放后可再次发起（冷却生效：1 组跳过重复刷新、未再触达网关）',
    evsC.some((e) => e.type === 'summary' && e.cooled === 1 && e.synced === 0)
      && gw.calls.filter((c) => c.apiPath === REFRESH_PATH).length === callsBeforeC,
    JSON.stringify(evsC.find((e) => e.type === 'summary')));
}

async function run() {
  try {
    await cases();
  } finally {
    httpLib.request = origRequest; // 恢复真实实现，避免影响后续测试
    delete process.env.OPENAPI_SESSION_FILE;
    removeFile(SESSION_FILE);
  }
}

module.exports = { run };
