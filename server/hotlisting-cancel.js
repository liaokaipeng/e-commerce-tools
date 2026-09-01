/**
 * Shopee 取消注册 Hot Listing 模块（CommonJS）
 * 由合并服务 main.js 引入，通过 register({ get, post }) 注册路由。
 * 与竞价导出/取消竞价共用同一份登录 Cookie（server/data/bidding-session.json，扩展推送保存）。
 *
 * 人工流程还原（接口还原，不用 UI 自动化）：
 *   访问 portal/marketing/cmt-buy-box?spuId=<SPU>，状态筛「已注册」，逐条点「取消注册」即：
 *   1) POST /api/mkt/buybox/get_rsku_vsku_list
 *      body { from_condition:{spu_id}, search_filter:{rsku_status:2, item_name:""},
 *             page_info:{offset, limit} }（rsku_status=2 即「已注册」，offset/limit 翻页）
 *      返回 data.vrsku_info_list[]：vsku_info.vsku_id / rsku_info.rsku_id（seller_decision=1 已注册；
 *      其中 qualification_flags=1 才是资格正常、可取消注册的行，=0 为异常行须过滤），
 *      data.page_info.total_count 为已注册总数；
 *   2) POST /api/mkt/buybox/update_enroll
 *      body { rsku_id, vsku_id, seller_decision:0 }，返回 code=0 且 seller_decision 变回 0 即成功。
 * 公共查询参数：SPC_CDS_VER=2 & SPC_CDS=<Cookie 值> & cnsc_shop_id=<店铺ID> & cbsc_shop_region=<市场>。
 */
const fs = require('fs');
const path = require('path');
const { request } = require('./lib/http');
const { sendJson, sse, readBody } = require('./lib/http-utils');

const SESSION_FILE = path.join(__dirname, 'data', 'bidding-session.json');
const STORES_FILE = path.join(__dirname, 'config', 'stores.json');
// 各店铺 SPU ID 配置（shopId -> SPU 文本，每行一个），持久化保存
const SPU_CONFIG_FILE = path.join(__dirname, 'data', 'hotlisting-spu.json');
const HOST = 'https://seller.shopee.cn';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const RSKU_STATUS_ENROLLED = 2;   // search_filter.rsku_status=2 即「已注册」
const PAGE_LIMIT = 20;            // 单页条数（抓包实测 8 可用；适度放大减少请求次数）
const MAX_PAGES = 200;            // 翻页上限（防死循环）
// 逐条取消注册之间的间隔，避免请求过快触发风控
const CANCEL_DELAY_MS = 300;

// ============ 执行任务的暂停控制（jobId -> { paused }） ============
const jobs = new Map();

function newJob() {
  const jobId = 'job_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
  jobs.set(jobId, { paused: false });
  return jobId;
}

function setPaused(jobId, paused) {
  const job = jobs.get(jobId);
  if (!job) return false;
  job.paused = !!paused;
  return true;
}

/** 暂停等待：任务被暂停时阻塞轮询，恢复后继续 */
async function waitIfPaused(jobId) {
  while (jobs.get(jobId) && jobs.get(jobId).paused) {
    await sleep(200);
  }
}

// ============ 店铺列表（与竞价导出共用 stores.json，热载） ============
function loadStores() {
  try {
    return JSON.parse(fs.readFileSync(STORES_FILE, 'utf8'));
  } catch (e) {
    console.warn('读取 stores.json 失败:', e.message);
    return [];
  }
}

// ============ 登录状态（与竞价导出共用 bidding-session.json） ============
function readSession() {
  if (!fs.existsSync(SESSION_FILE)) return null;
  try { return JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8')); }
  catch (e) { console.warn('读取会话文件失败:', e.message); return null; }
}

/** 组装 seller.shopee.cn 的 Cookie（逻辑与 bidding.js 保持一致），并附带 SPC_CDS 值 */
function loadCookie(targetDomain = 'seller.shopee.cn') {
  const session = readSession();
  if (!session || !session.cookies || session.cookies.length === 0) {
    throw new Error('未找到登录 Cookie，请先在浏览器点扩展「发送登录信息到本地工具」');
  }
  const matched = session.cookies.filter(c => {
    const d = String(c.domain || '').toLowerCase();
    if (!d) return false;
    const base = d.startsWith('.') ? d.slice(1) : d;
    return targetDomain === base || targetDomain.endsWith('.' + base);
  });
  if (matched.length === 0) {
    throw new Error('没有匹配 seller.shopee.cn 的 Cookie，请重新点扩展推送');
  }
  const header = matched.map(c => `${c.name}=${c.value}`).join('; ');
  const spcCds = (matched.find(c => c.name === 'SPC_CDS') || {}).value || '';
  return { header, spcCds };
}

function assertLoginOk(resp) {
  if (resp.status === 403 || (resp.text && resp.text.includes('token not found'))) {
    throw new Error('登录已失效（403 token not found），请重新登录卖家中心并点扩展推送');
  }
}

/** 拼 buybox 接口 URL：公共参数 SPC_CDS_VER / SPC_CDS / cnsc_shop_id / cbsc_shop_region 统一附加 */
function buildUrl(apiPath, { spcCds }, shopId, region) {
  const params = new URLSearchParams();
  params.set('SPC_CDS_VER', '2');
  if (spcCds) params.set('SPC_CDS', spcCds);
  params.set('cnsc_shop_id', String(shopId));
  params.set('cbsc_shop_region', String(region));
  return `${HOST}${apiPath}?${params.toString()}`;
}

async function apiPost(cookie, url, body, referer) {
  const resp = await request({
    method: 'POST',
    url,
    headers: {
      'Content-Type': 'application/json',
      'Cookie': cookie.header,
      'User-Agent': UA,
      'Accept': 'application/json, text/plain, */*',
      'Origin': HOST,
      ...(referer ? { Referer: referer } : {}),
    },
    body: JSON.stringify(body),
  });
  assertLoginOk(resp);
  const j = resp.json;
  if (!j || typeof j !== 'object') throw new Error('接口返回异常：' + String(resp.text || '').slice(0, 120));
  return j;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ============ Shopee 接口链路 ============

/** 获取店铺市场（cbsc_shop_region），失败默认 ph */
async function fetchShopRegion(cookie, shopId) {
  try {
    const resp = await request({
      url: `${HOST}/api/framework/selleraccount/shop_info/?SPC_CDS_VER=2&cnsc_shop_id=${shopId}`,
      headers: { 'Cookie': cookie.header, 'User-Agent': UA, 'Accept': 'application/json' },
    });
    assertLoginOk(resp);
    const j = resp.json;
    if (j.code === 0 && j.data && j.data.shop_region) return String(j.data.shop_region).toLowerCase();
  } catch (e) {
    console.warn(`获取店铺 ${shopId} 市场失败，默认 ph: ${e.message}`);
  }
  return 'ph';
}

/**
 * 解析用户输入的 SPU 列表：接受数组或换行/逗号/空格分隔的字符串，返回纯数字 ID 数组（去重保序）。
 * 含非法内容时返回 { error } 提示（纯函数，便于单测）。
 */
function parseSpuList(input) {
  const raw = Array.isArray(input) ? input.join('\n') : String(input || '');
  const tokens = raw.split(/[\s,;，；、]+/).map(s => s.trim()).filter(Boolean);
  const spus = [];
  const seen = new Set();
  const invalid = [];
  for (const t of tokens) {
    if (/^\d{5,20}$/.test(t)) {
      if (!seen.has(t)) { seen.add(t); spus.push(t); }
    } else {
      invalid.push(t);
    }
  }
  if (invalid.length) {
    return { error: `SPU ID 含非法内容（仅支持纯数字，每行一个）：${invalid.slice(0, 3).join('、')}${invalid.length > 3 ? ' 等' : ''}` };
  }
  if (spus.length === 0) return { error: '请先填写至少一个 SPU ID（在卖家中心商品列表/链接中可查）' };
  if (spus.length > 200) return { error: `SPU 数量过多（${spus.length} 个，上限 200），请分批操作` };
  return { spus };
}

/**
 * 从 get_rsku_vsku_list 的响应 data 中提取可取消注册的 SKU 行（纯函数，便于单测）。
 * 只保留同时满足两个条件的行：
 *   1) seller_decision=1（已注册，rsku_status=2 过滤后理论全为已注册，此处兜底防误取消）；
 *   2) qualification_flags=1（资格正常）。实测列表里存在 qualification_flags=0 的异常行
 *      （如 stock_unqualified），这类 SKU 无法取消注册，必须过滤，否则逐条取消会报错。
 * @returns {Array<{rskuId, vskuId, itemId, itemName, modelName, ritemId, vitemId, previewLink}>}
 */
function extractEnrolledSkus(data) {
  const rows = [];
  for (const entry of (data && data.vrsku_info_list) || []) {
    const v = entry.vsku_info || {};
    const r = entry.rsku_info || {};
    if (Number(r.seller_decision) !== 1) continue;
    if (Number(r.qualification_flags) !== 1) continue;
    if (!r.rsku_id || !v.vsku_id) continue;
    rows.push({
      rskuId: String(r.rsku_id),
      vskuId: String(v.vsku_id),
      ritemId: String(r.ritem_id || ''),
      vitemId: String(v.vitem_id || ''),
      itemName: String(r.title || v.title || ''),
      modelName: String(r.variation_name || v.variation_name || ''),
      previewLink: String((entry.vitem_info && entry.vitem_info.preview_link) || ''),
    });
  }
  return rows;
}

/**
 * 拉取一个 SPU 的全部「已注册」SKU（offset/limit 翻页取全）。
 * @returns {Array} extractEnrolledSkus 的行
 */
async function fetchEnrolledSkus(cookie, shopId, region, spuId) {
  const url = buildUrl('/api/mkt/buybox/get_rsku_vsku_list', cookie, shopId, region);
  const referer = `${HOST}/portal/marketing/cmt-buy-box?spuId=${spuId}&trackerSource=1&cnsc_shop_id=${shopId}`;
  const rows = [];
  let offset = 0;
  for (let page = 1; page <= MAX_PAGES; page++) {
    const j = await apiPost(cookie, url, {
      from_condition: { spu_id: Number(spuId) },
      search_filter: { rsku_status: RSKU_STATUS_ENROLLED, item_name: '' },
      page_info: { offset, limit: PAGE_LIMIT },
    }, referer);
    if (j.code !== 0) throw new Error(`获取已注册列表失败: code=${j.code} msg=${j.msg || j.message || ''}`);
    const d = j.data || {};
    rows.push(...extractEnrolledSkus(d));
    const pageInfo = d.page_info || {};
    const total = Number(pageInfo.total_count || 0);
    offset += PAGE_LIMIT;
    if (offset >= total || (d.vrsku_info_list || []).length === 0) break;
  }
  return rows;
}

/** 取消注册一条 SKU（update_enroll，seller_decision 置 0） */
async function unenrollSku(cookie, shopId, region, rskuId, vskuId) {
  const j = await apiPost(cookie, buildUrl('/api/mkt/buybox/update_enroll', cookie, shopId, region), {
    rsku_id: Number(rskuId),
    vsku_id: Number(vskuId),
    seller_decision: 0,
  });
  if (j.code !== 0) throw new Error(`取消注册失败: code=${j.code} msg=${j.msg || j.message || ''}`);
  return j;
}

// ============ 店铺 SPU 配置（持久化到 server/data/hotlisting-spu.json） ============
function loadSpuConfig() {
  try {
    const map = JSON.parse(fs.readFileSync(SPU_CONFIG_FILE, 'utf8'));
    return map && typeof map === 'object' ? map : {};
  } catch (e) {
    return {};
  }
}

function saveSpuConfig(map) {
  fs.writeFileSync(SPU_CONFIG_FILE, JSON.stringify(map, null, 2), 'utf8');
}

/**
 * 解析前端提交的 SPU 配置并归一化（纯函数，便于单测）：
 * 保留值为非空字符串的店铺（去除首尾空白），其余丢弃。
 * @param {Object} raw 前端提交的 { shopId: spuText }
 * @returns {Object} 归一化后的 { shopId: spuText }
 */
function normalizeSpuMap(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [k, v] of Object.entries(raw)) {
    if (!/^\d{1,20}$/.test(String(k))) continue;
    const text = String(v || '').trim();
    if (text) out[String(k)] = text;
  }
  return out;
}

/**
 * 汇总每个选中店铺要操作的 SPU 列表（纯函数，便于单测）。
 * 请求体携带 spuMap 时以其为完整当前状态（清空也生效）；否则回落到已保存配置。
 * @returns {{ perShop: Object<string, {spus?: string[], error?: string}>, validCount: number }}
 */
function resolvePerShopSpus(shopIds, bodySpuMap, savedConfig) {
  const hasBodyMap = bodySpuMap && typeof bodySpuMap === 'object' && !Array.isArray(bodySpuMap);
  const merged = hasBodyMap ? normalizeSpuMap(bodySpuMap) : { ...savedConfig };
  const perShop = {};
  let validCount = 0;
  for (const id of shopIds) {
    const text = merged[String(id)];
    if (!text) {
      perShop[String(id)] = { error: '未配置 SPU ID，请先在上方卡片填写并保存' };
      continue;
    }
    const { spus, error } = parseSpuList(text);
    if (error) {
      perShop[String(id)] = { error };
      continue;
    }
    perShop[String(id)] = { spus };
    validCount += spus.length;
  }
  return { perShop, validCount };
}

// ============ 预览接口（JSON，非 SSE） ============
async function handlePreview(body, res) {
  const shopIds = Array.isArray(body.shopIds) ? body.shopIds : [];
  if (shopIds.length === 0) {
    sendJson(res, 400, { ok: false, msg: '请先选择至少一个店铺' });
    return;
  }
  const { perShop } = resolvePerShopSpus(shopIds, body.spuMap, loadSpuConfig());
  if (Object.values(perShop).every(p => p.error)) {
    sendJson(res, 400, { ok: false, msg: '所选店铺均未配置有效的 SPU ID' });
    return;
  }
  const stores = loadStores();
  let cookie;
  try {
    cookie = loadCookie();
  } catch (e) {
    sendJson(res, 400, { ok: false, msg: e.message });
    return;
  }

  const shops = [];
  for (const id of shopIds) {
    const store = stores.find(s => s.id === String(id));
    const name = store ? store.name : String(id);
    const plan = perShop[String(id)] || { error: '未配置 SPU ID' };
    if (plan.error) {
      shops.push({ shopId: String(id), name, ok: false, msg: plan.error, region: '', spuCount: 0, skuCount: 0, spus: [] });
      continue;
    }
    try {
      const region = await fetchShopRegion(cookie, String(id));
      const spuRows = [];
      for (const spuId of plan.spus) {
        try {
          const items = await fetchEnrolledSkus(cookie, String(id), region, spuId);
          spuRows.push({ spuId, ok: true, msg: '', skuCount: items.length, items });
        } catch (e) {
          spuRows.push({ spuId, ok: false, msg: e.message, skuCount: 0, items: [] });
        }
      }
      shops.push({
        shopId: String(id),
        name,
        ok: true,
        msg: '',
        region,
        spuCount: plan.spus.length,
        skuCount: spuRows.reduce((n, s) => n + s.skuCount, 0),
        spus: spuRows,
      });
    } catch (e) {
      shops.push({ shopId: String(id), name, ok: false, msg: e.message, region: '', spuCount: 0, skuCount: 0, spus: [] });
    }
  }
  sendJson(res, 200, { ok: true, shops });
}

// ============ 执行取消注册接口（SSE 流式事件） ============
function handleRun(body, res) {
  const shopIds = Array.isArray(body.shopIds) ? body.shopIds : [];
  if (shopIds.length === 0) {
    sendJson(res, 400, { ok: false, msg: '请先选择至少一个店铺' });
    return;
  }
  const { perShop } = resolvePerShopSpus(shopIds, body.spuMap, loadSpuConfig());
  if (Object.values(perShop).every(p => p.error)) {
    sendJson(res, 400, { ok: false, msg: '所选店铺均未配置有效的 SPU ID' });
    return;
  }
  const emit = sse(res);
  const jobId = newJob();

  (async () => {
    const stores = loadStores();
    let cookie;
    try {
      cookie = loadCookie();
    } catch (e) {
      jobs.delete(jobId);
      emit({ type: 'fatal', msg: e.message });
      res.end();
      return;
    }
    // 先下发 jobId，前端据此发暂停/继续指令
    emit({ type: 'start', jobId });

    const results = [];
    for (const id of shopIds) {
      await waitIfPaused(jobId);
      const store = stores.find(s => s.id === String(id));
      const name = store ? store.name : String(id);
      const plan = perShop[String(id)] || { error: '未配置 SPU ID' };
      emit({ type: 'shop-start', shopId: String(id), name });
      if (plan.error) {
        emit({ type: 'shop-done', shopId: String(id), name, ok: false, cancelled: 0, failed: 0, msg: plan.error });
        results.push({ shopId: String(id), name, ok: false, cancelled: 0, failed: 0 });
        continue;
      }
      let cancelled = 0;
      let failed = 0;
      try {
        const region = await fetchShopRegion(cookie, String(id));
        for (const spuId of plan.spus) {
          await waitIfPaused(jobId);
          // 实时拉取最新已注册列表（预览后状态可能已变化）
          let rows;
          try {
            rows = await fetchEnrolledSkus(cookie, String(id), region, spuId);
          } catch (e) {
            failed += 1;
            emit({ type: 'spu-done', shopId: String(id), spuId, ok: false, msg: e.message });
            continue;
          }
          if (rows.length === 0) {
            emit({ type: 'spu-done', shopId: String(id), spuId, ok: true, cancelled: 0, msg: '无已注册 SKU' });
            continue;
          }
          for (const r of rows) {
            await waitIfPaused(jobId);
            emit({
              type: 'sku-start',
              shopId: String(id),
              spuId,
              itemName: r.itemName,
              modelName: r.modelName,
            });
            try {
              await unenrollSku(cookie, String(id), region, r.rskuId, r.vskuId);
              cancelled += 1;
              emit({ type: 'sku-done', shopId: String(id), spuId, itemName: r.itemName, ok: true });
            } catch (e) {
              failed += 1;
              emit({ type: 'sku-done', shopId: String(id), spuId, itemName: r.itemName, ok: false, msg: e.message });
            }
            await sleep(CANCEL_DELAY_MS);
          }
          emit({ type: 'spu-done', shopId: String(id), spuId, ok: true, cancelled: rows.length });
        }
        emit({ type: 'shop-done', shopId: String(id), name, ok: true, cancelled, failed, msg: '' });
        results.push({ shopId: String(id), name, ok: true, cancelled, failed });
      } catch (e) {
        emit({ type: 'shop-done', shopId: String(id), name, ok: false, cancelled: 0, failed: 0, msg: e.message });
        results.push({ shopId: String(id), name, ok: false, cancelled: 0, failed: 0, msg: e.message });
      }
    }
    jobs.delete(jobId);
    emit({
      type: 'summary',
      cancelled: results.reduce((n, r) => n + (r.cancelled || 0), 0),
      failed: results.reduce((n, r) => n + (r.failed || 0), 0),
      success: results.filter(r => r.ok).length,
      total: results.length,
    });
    try { res.end(); } catch { /* ignore */ }
  })().catch((e) => {
    try { emit({ type: 'fatal', msg: `取消注册失败：${e.message}` }); res.end(); } catch { /* ignore */ }
  });
}

// ============ 路由注册 ============
function register({ get, post }) {
  // 各店铺 SPU 配置：读取 / 保存（前端编辑后自动保存）
  get('/api/hotlisting-cancel/spu-config', async (req, res, query) => {
    sendJson(res, 200, { ok: true, map: loadSpuConfig() });
  });

  post('/api/hotlisting-cancel/spu-config', async (req, res) => {
    let parsed = {};
    try { parsed = JSON.parse(await readBody(req)); } catch (e) { console.warn('解析 /api/hotlisting-cancel/spu-config 请求体失败:', e.message); }
    try {
      const map = normalizeSpuMap(parsed.map);
      saveSpuConfig(map);
      sendJson(res, 200, { ok: true, map });
    } catch (e) {
      sendJson(res, 500, { ok: false, msg: '保存 SPU 配置失败：' + e.message });
    }
  });

  post('/api/hotlisting-cancel/preview', async (req, res) => {
    let parsed = {};
    try { parsed = JSON.parse(await readBody(req)); } catch (e) { console.warn('解析 /api/hotlisting-cancel/preview 请求体失败:', e.message); }
    handlePreview(parsed, res);
  });

  post('/api/hotlisting-cancel/run', async (req, res) => {
    let parsed = {};
    try { parsed = JSON.parse(await readBody(req)); } catch (e) { console.warn('解析 /api/hotlisting-cancel/run 请求体失败:', e.message); }
    handleRun(parsed, res);
  });

  // 暂停 / 继续执行中的任务（body { jobId }，jobId 由 run 的 start 事件下发）
  post('/api/hotlisting-cancel/pause', async (req, res) => {
    let parsed = {};
    try { parsed = JSON.parse(await readBody(req)); } catch (e) { console.warn('解析 /api/hotlisting-cancel/pause 请求体失败:', e.message); }
    const ok = setPaused(parsed.jobId, true);
    sendJson(res, ok ? 200 : 404, ok ? { ok: true } : { ok: false, msg: '任务不存在或已结束' });
  });

  post('/api/hotlisting-cancel/resume', async (req, res) => {
    let parsed = {};
    try { parsed = JSON.parse(await readBody(req)); } catch (e) { console.warn('解析 /api/hotlisting-cancel/resume 请求体失败:', e.message); }
    const ok = setPaused(parsed.jobId, false);
    sendJson(res, ok ? 200 : 404, ok ? { ok: true } : { ok: false, msg: '任务不存在或已结束' });
  });
}

module.exports = { register, parseSpuList, extractEnrolledSkus, fetchEnrolledSkus, unenrollSku, normalizeSpuMap, resolvePerShopSpus };
