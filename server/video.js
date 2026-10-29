'use strict';
/**
 * Shopee 视频批量上传模块（CommonJS）
 * 由合并服务 main.js 引入，通过 register({ get, post }) 注册路由。
 * 接口流程：item/list 商品前置校验（商品为空/找不到 → 跳过该行）-> preupload -> 分片 upload
 * -> mergeFiles -> reportupload -> video/create
 * 凭证由浏览器扩展推送至 /api/creds，保存到本目录 video-session.json。
 *
 * 本文件只负责「路由注册」，链路编排拆分到 video/ 子模块：
 *   constants.js  常量与站点配置
 *   request.js    统一出站请求（重试/取消）与分片读
 *   creds.js      凭证存储与跨境凭证解析
 *   upload-cn.js  跨境 .cn 上传链路
 *   upload-ph.js  本土菲律宾 .ph 上传链路
 *   job.js        Job/SSE 事件、回放、取消与收尾
 */
const crypto = require('crypto');
const { sendJson, sse, readJsonBodySoft } = require('./lib/http-utils');
const { SITES } = require('./video/constants');
const {
  storedCreds,
  credsPatch,
  getCreds,
  setCredsFor,
  getCnShop,
  setCnShop,
} = require('./video/creds');
const { uploadOneCn } = require('./video/upload-cn');
const { uploadOnePh } = require('./video/upload-ph');
const {
  clients,
  jobEvents,
  jobControllers,
  abortedJobs,
  broadcast,
  finishJob,
  processJob,
} = require('./video/job');

// ============ 路由处理（事件回放 / 凭证 / 任务启停） ============

/** GET /api/events：任务 SSE 事件流（支持迟到连接回放） */
function handleEvents(req, res, url) {
  const jobId = url.searchParams.get('jobId');
  // CORS 由 main.js 统一按白名单处理，这里不再单独写 Access-Control-Allow-Origin
  const emit = sse(res, { 'X-Accel-Buffering': 'no' });
  emit({ type: 'connected' });
  // 迟到连接：任务已产生过事件（可能已结束）则回放，若已到终态（finished/cancelled/fatal）直接关闭。
  // 只认 finished 会让以 cancelled/fatal 结束的任务在回放后被重新挂进 clients，连接永不释放。
  const past = jobEvents.get(jobId) || [];
  for (const ev of past) {
    if (res.writableEnded) break;
    emit(ev);
  }
  const terminal = past.length ? past[past.length - 1].type : '';
  if (terminal === 'finished' || terminal === 'cancelled' || terminal === 'fatal') {
    res.end();
    return;
  }
  if (!clients.has(jobId)) clients.set(jobId, new Set());
  clients.get(jobId).add(res);
  req.on('close', () => {
    const set = clients.get(jobId);
    if (set) {
      set.delete(res);
      if (!set.size) clients.delete(jobId);
    }
  });
}

/** GET /api/creds：返回全部站点的凭证，由前端按所选站点取用 */
function handleCredsGet(req, res) {
  sendJson(res, 200, { sites: storedCreds, updatedAt: Date.now() });
}

/** 批量推送的单站点归一化：cn 按店铺存储（shops / 旧扁平兜底），其余站点归一化为扁平结构 */
function applyBatchSite(s, v) {
  if (s === 'cn') {
    if (v.shops && typeof v.shops === 'object') {
      for (const [shopId, sv] of Object.entries(v.shops)) {
        if (!sv || typeof sv !== 'object') continue;
        setCnShop(shopId, credsPatch(sv, false));
      }
    } else if (v.shopId) {
      // 兼容旧扁平批量格式：{ cn: { auth, cookie, shopId, userid } } → 归入该店铺
      setCnShop(v.shopId, credsPatch(v, false));
    }
    return;
  }
  // 扩展对所有站点统一推 { shops: {...} }（见 extension/background.js push）；
  // ph 等单店铺站点归一化为扁平结构存储，否则 credsPatch 拿不到字段、凭证被静默丢弃
  let flat = v;
  if (v.shops && typeof v.shops === 'object') {
    const ids = Object.keys(v.shops);
    const first = ids.map((id) => v.shops[id]).find((sv) => sv && typeof sv === 'object');
    flat = first ? Object.assign({ shopId: ids[0] }, first) : {};
  }
  setCredsFor(s, credsPatch(flat, true));
}

/** POST /api/creds：扩展推送凭证（单条 site / 批量 sites） */
async function handleCredsPost(req, res) {
  const p = await readJsonBodySoft(req, '/api/creds');
  let applied = 0;
  // 扩展单条推送：{ site, auth, cookie, shopId, userid }
  if (p.site && SITES[p.site]) {
    // 跨境按店铺存储：无 shopId 的扁平推送若落入 setCredsFor 会把 { shops: {...} }
    // 整个覆盖成扁平结构，导致全部跨境店铺凭证丢失并落盘，必须明确拒绝
    if (p.site === 'cn' && !p.shopId) {
      sendJson(res, 400, { ok: false, message: '跨境（cn）凭证推送必须带 shopId（按店铺存储）' });
      return;
    }
    if (p.site === 'cn') setCnShop(p.shopId, credsPatch(p, false));
    else setCredsFor(p.site, credsPatch(p, true));
    applied += 1;
  }
  // 扩展批量推送：{ sites: { cn: { shops: {...} }, ph: {...} } }
  if (p.sites && typeof p.sites === 'object') {
    for (const [s, v] of Object.entries(p.sites)) {
      if (!SITES[s] || !v || typeof v !== 'object') continue;
      applied += 1;
      applyBatchSite(s, v);
    }
  }
  // 既无 site 也无 sites：没有写入任何凭证，明确回报失败（不再静默返回 ok）
  if (!applied) {
    sendJson(res, 400, { ok: false, message: '缺少 site 或 sites，未写入任何凭证' });
    return;
  }
  sendJson(res, 200, { ok: true, updatedAt: Date.now() });
}

/** POST /api/start：建任务（优先用前端传入凭证，其次用本机已存储的该站点凭证；cn 按店铺取存根） */
async function handleStart(req, res) {
  const parsed = await readJsonBodySoft(req, '/api/start');
  const { site = 'cn', rows, auth, cookie, shopId, userid } = parsed;
  const siteKey = SITES[site] ? site : 'cn';
  if (!Array.isArray(rows) || !rows.length) {
    sendJson(res, 400, { ok: false, message: '缺少 rows' });
    return;
  }
  let creds;
  if (siteKey === 'cn' && shopId) {
    const shop = getCnShop(shopId);
    creds = {
      auth: auth || shop.auth,
      cookie: cookie || shop.cookie,
      shopId: String(shopId),
      userid: userid || shop.userid || '',
    };
  } else {
    const stored = getCreds(siteKey);
    creds = {
      auth: auth || stored.auth,
      cookie: cookie || stored.cookie,
      shopId: shopId || stored.shopId,
      userid: userid || stored.userid || '',
    };
  }
  const jobId = crypto.randomBytes(8).toString('hex');
  clients.set(jobId, new Set());
  jobControllers.set(jobId, new AbortController());
  sendJson(res, 200, { jobId });
  const uploadOne = siteKey === 'ph'
    ? (row, creds, log, signal) => uploadOnePh(row, creds, siteKey, log, signal)
    : (row, creds, log, signal) => uploadOneCn(row, creds, log, signal);
  processJob(jobId, rows, creds, uploadOne).catch((e) => {
    broadcast(jobId, { type: 'fatal', error: e.message });
    finishJob(jobId);
  });
}

/** POST /api/cancel：标记取消并中断进行中的请求；processJob 见取消标志后广播 cancelled 并收尾 */
async function handleCancel(req, res) {
  const parsed = await readJsonBodySoft(req, '/api/cancel');
  const jobId = String(parsed.jobId || '');
  if (!jobId) {
    sendJson(res, 400, { ok: false, message: '缺少 jobId' });
    return;
  }
  if (!jobControllers.has(jobId)) {
    sendJson(res, 404, { ok: false, message: '任务不存在或已结束' });
    return;
  }
  abortedJobs.add(jobId);
  const c = jobControllers.get(jobId);
  if (c) c.abort();
  sendJson(res, 200, { ok: true });
}

/** 注册路由 */
function register({ get, post }) {
  get('/api/events', handleEvents);
  get('/api/creds', handleCredsGet);
  post('/api/creds', handleCredsPost);
  post('/api/start', handleStart);
  post('/api/cancel', handleCancel);
}

module.exports = { register };

// 仅供单元测试使用的内部状态与任务调度（无需启动服务即可确定性验证取消逻辑）
module.exports._test = {
  processJob,
  jobEvents,
  clients,
  broadcast,
  abortedJobs,
  jobControllers,
  finishJob,
};
