'use strict';
/**
 * Shopee 视频批量上传模块（CommonJS）
 * 由合并服务 main.js 引入，通过 register({ get, post }) 注册路由。
 * 接口流程：preupload -> 分片 upload -> mergeFiles -> reportupload -> item/list -> video/create
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
const { sendJson, sse, readBody } = require('./lib/http-utils');
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

// ============ 路由注册 ============
function register({ get, post }) {
  get('/api/events', (req, res, url) => {
    const jobId = url.searchParams.get('jobId');
    sse(res, { 'Access-Control-Allow-Origin': '*' });
    res.write(`data: ${JSON.stringify({ type: 'connected' })}\n\n`);
    // 迟到连接：任务已产生过事件（可能已结束）则回放，若已 finished 直接关闭
    const past = jobEvents.get(jobId) || [];
    for (const ev of past) {
      if (res.writableEnded) break;
      res.write(`data: ${JSON.stringify(ev)}\n\n`);
    }
    if (past.length && past[past.length - 1].type === 'finished') {
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
  });

  // 凭证：扩展推送（POST）/ 网页读取（GET）
  get('/api/creds', (req, res) => {
    // 返回全部站点的凭证，由前端按所选站点取用
    sendJson(res, 200, { sites: storedCreds, updatedAt: Date.now() });
  });

  post('/api/creds', async (req, res) => {
    try {
      const p = JSON.parse(await readBody(req));
      // 扩展单条推送：{ site, auth, cookie, shopId, userid }
      if (p.site && SITES[p.site]) {
        if (p.site === 'cn' && p.shopId) setCnShop(p.shopId, credsPatch(p, false));
        else setCredsFor(p.site, credsPatch(p, true));
      }
      // 扩展批量推送：{ sites: { cn: { shops: {...} }, ph: {...} } }
      if (p.sites && typeof p.sites === 'object') {
        for (const [s, v] of Object.entries(p.sites)) {
          if (!SITES[s] || !v || typeof v !== 'object') continue;
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
          } else {
            setCredsFor(s, credsPatch(v, true));
          }
        }
      }
    } catch (e) { /* ignore */ }
    sendJson(res, 200, { ok: true, updatedAt: Date.now() });
  });

  post('/api/start', async (req, res) => {
    let parsed;
    try {
      parsed = JSON.parse(await readBody(req));
    } catch (e) {
      sendJson(res, 400, { ok: false, message: 'Invalid JSON' });
      return;
    }
    const { site = 'cn', rows, auth, cookie, shopId, userid } = parsed;
    const siteKey = SITES[site] ? site : 'cn';
    if (!Array.isArray(rows) || !rows.length) {
      sendJson(res, 400, { ok: false, message: '缺少 rows' });
      return;
    }
    // 优先用前端传入的凭证，其次用本机已存储的该站点凭证。
    // 跨境 cn 支持多店铺：按 shopId 取对应店铺存根。
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
      creds = {
        auth: auth || getCreds(siteKey).auth,
        cookie: cookie || getCreds(siteKey).cookie,
        shopId: shopId || getCreds(siteKey).shopId,
        userid: userid || getCreds(siteKey).userid || '',
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
  });

  // 取消任务：标记取消并中断进行中的请求；processJob 见取消标志后广播 cancelled 并收尾
  post('/api/cancel', async (req, res) => {
    let jobId = '';
    try { jobId = String((JSON.parse(await readBody(req)) || {}).jobId || ''); } catch (e) { jobId = ''; }
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
  });
}

module.exports = { register };

// 仅供单元测试使用的内部状态与任务调度（无需启动服务即可确定性验证取消逻辑）
module.exports._test = {
  processJob,
  jobEvents,
  broadcast,
  abortedJobs,
  jobControllers,
  finishJob,
};
