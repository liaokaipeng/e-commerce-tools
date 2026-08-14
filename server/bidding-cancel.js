/**
 * Shopee 取消竞价模块（CommonJS）
 * 由合并服务 main.js 引入，通过 register({ get, post }) 注册路由。
 * 与竞价导出共用同一份登录 Cookie（server/data/bidding-session.json，扩展推送保存）。
 *
 * 人工流程还原（接口还原，不用 UI 自动化）：
 *   列表页「进行中的竞价」→「待改进」Tab 即 get_item_ongoing_list 的 page_tab=2，
 *   其中每个 model 都是一条待改进竞价（bid_status=40 / 价格缺乏竞争力），
 *   逐个点击「撤销」即 seller_withdraw { bid_id }。
 */
const fs = require('fs');
const path = require('path');
const { request } = require('./lib/http');
const { sendJson, sse, readBody } = require('./lib/http-utils');

const SESSION_FILE = path.join(__dirname, 'data', 'bidding-session.json');
const STORES_FILE = path.join(__dirname, 'config', 'stores.json');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
// 待改进 Tab 的 page_tab 值（page_tab=1 为「进行中的竞价」全部，2 为其中「待改进」）
const PAGE_TAB_IMPROVE = 2;
// 逐条撤销之间的间隔，避免请求过快触发风控
const WITHDRAW_DELAY_MS = 300;

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

/** 组装 seller.shopee.cn 的 Cookie 请求头（逻辑与 bidding.js 保持一致） */
function loadCookieHeader(targetDomain = 'seller.shopee.cn') {
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
  return matched.map(c => `${c.name}=${c.value}`).join('; ');
}

function assertLoginOk(resp) {
  if (resp.status === 403 || (resp.text && resp.text.includes('token not found'))) {
    throw new Error('登录已失效（403 token not found），请重新登录卖家中心并点扩展推送');
  }
}

async function apiGet(cookieHeader, url) {
  const resp = await request({
    url,
    headers: { 'Cookie': cookieHeader, 'User-Agent': UA, 'Accept': 'application/json' },
  });
  assertLoginOk(resp);
  return resp.json;
}

async function apiPost(cookieHeader, url, body) {
  const resp = await request({
    method: 'POST',
    url,
    headers: { 'Content-Type': 'application/json', 'Cookie': cookieHeader, 'User-Agent': UA, 'Accept': 'application/json' },
    body: JSON.stringify(body),
  });
  assertLoginOk(resp);
  return resp.json;
}

/** 金额：接口返回单位为 1/100000 本币（与 bidding.js 的 toAmount 一致），除以 100000 并四舍五入到分 */
function toAmount(v) {
  if (v === null || v === undefined || v === '' || v === '0' || v === 0) return '';
  const n = Number(v) / 100000;
  return Math.round(n * 100) / 100;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ============ Shopee 接口链路 ============

/** 获取店铺市场（cbsc_shop_region），失败默认 ph */
async function fetchShopRegion(cookieHeader, shopId) {
  try {
    const j = await apiGet(cookieHeader, `https://seller.shopee.cn/api/framework/selleraccount/shop_info/?SPC_CDS_VER=2&cnsc_shop_id=${shopId}`);
    if (j.code === 0 && j.data && j.data.shop_region) return String(j.data.shop_region).toLowerCase();
  } catch (e) {
    console.warn(`获取店铺 ${shopId} 市场失败，默认 ph: ${e.message}`);
  }
  return 'ph';
}

/**
 * 从 get_item_ongoing_list 的响应 data 中提取「待改进」竞价行（纯函数，便于单测）。
 * @param {object} data 接口响应的 data（含 list / has_more）
 * @returns {Array<{itemId, itemName, modelId, modelName, bidId, price, suggestedPrice}>}
 */
function extractImprovementItems(data) {
  const rows = [];
  for (const item of (data && data.list) || []) {
    for (const model of item.model_list || []) {
      const b = model.bidding_info || {};
      if (!b.bid_id) continue; // 无竞价编号的不可撤销
      rows.push({
        itemId: String(item.item_id),
        itemName: String(item.item_name || ''),
        modelId: String(model.product_info?.model_id ?? ''),
        modelName: String(model.product_info?.model_name ?? ''),
        bidId: String(b.bid_id),
        price: toAmount(b.bid_price),
        suggestedPrice: toAmount(b.default_suggest_price),
      });
    }
  }
  return rows;
}

/**
 * 拉取「待改进」竞价列表（page_tab=2），翻页取全部。
 * @returns {Array<{itemId, itemName, modelId, modelName, bidId, price, suggestedPrice}>}
 */
async function fetchImprovementBids(cookieHeader, shopId, region) {
  const base = `https://seller.shopee.cn/api/mkt/bidding/get_item_ongoing_list?SPC_CDS_VER=2&cnsc_shop_id=${shopId}&cbsc_shop_region=${region}`;
  const rows = [];
  let pageNum = 1;
  while (true) {
    const j = await apiPost(cookieHeader, base, {
      filter: { page_tab: PAGE_TAB_IMPROVE },
      page_info: { page_num: pageNum, page_size: 100 },
      option: { with_performance: true },
    });
    if (j.code !== 0) throw new Error(`获取待改进列表失败: code=${j.code} msg=${j.msg}`);
    const d = j.data;
    rows.push(...extractImprovementItems(d));
    if (!d.has_more) break;
    pageNum += 1;
    if (pageNum > 200) throw new Error('翻页超过 200 页，疑似死循环，已停止');
  }
  return rows;
}

/** 撤销一条竞价（seller_withdraw） */
async function withdrawBid(cookieHeader, shopId, region, bidId) {
  const j = await apiPost(cookieHeader, `https://seller.shopee.cn/api/mkt/bidding/seller_withdraw?SPC_CDS_VER=2&cnsc_shop_id=${shopId}&cbsc_shop_region=${region}`, {
    bid_id: String(bidId),
  });
  if (j.code !== 0) throw new Error(`撤销失败: code=${j.code} msg=${j.msg}`);
  return j;
}

// ============ 预览接口（JSON，非 SSE） ============
async function handlePreview(body, res) {
  const shopIds = Array.isArray(body.shopIds) ? body.shopIds : [];
  if (shopIds.length === 0) {
    sendJson(res, 400, { ok: false, msg: '请先选择至少一个店铺' });
    return;
  }
  const stores = loadStores();
  let cookieHeader;
  try {
    cookieHeader = loadCookieHeader();
  } catch (e) {
    sendJson(res, 400, { ok: false, msg: e.message });
    return;
  }

  const shops = [];
  for (const id of shopIds) {
    const store = stores.find(s => s.id === String(id));
    const name = store ? store.name : String(id);
    try {
      const region = await fetchShopRegion(cookieHeader, String(id));
      const rows = await fetchImprovementBids(cookieHeader, String(id), region);
      shops.push({
        shopId: String(id),
        name,
        ok: true,
        msg: '',
        region,
        itemCount: new Set(rows.map(r => r.itemId)).size,
        bidCount: rows.length,
        items: rows,
      });
    } catch (e) {
      shops.push({ shopId: String(id), name, ok: false, msg: e.message, region: '', itemCount: 0, bidCount: 0, items: [] });
    }
  }
  sendJson(res, 200, { ok: true, shops });
}

// ============ 执行撤销接口（SSE 流式事件） ============
function handleRun(body, res) {
  const shopIds = Array.isArray(body.shopIds) ? body.shopIds : [];
  if (shopIds.length === 0) {
    sendJson(res, 400, { ok: false, msg: '请先选择至少一个店铺' });
    return;
  }
  const emit = sse(res);

  (async () => {
    const stores = loadStores();
    let cookieHeader;
    try {
      cookieHeader = loadCookieHeader();
    } catch (e) {
      emit({ type: 'fatal', msg: e.message });
      res.end();
      return;
    }

    const results = [];
    for (const id of shopIds) {
      const store = stores.find(s => s.id === String(id));
      const name = store ? store.name : String(id);
      emit({ type: 'shop-start', shopId: String(id), name });
      try {
        const region = await fetchShopRegion(cookieHeader, String(id));
        // 实时拉取最新待改进列表（预览后状态可能已变化）
        const rows = await fetchImprovementBids(cookieHeader, String(id), region);
        let cancelled = 0;
        let failed = 0;
        for (const r of rows) {
          emit({
            type: 'bid-start',
            shopId: String(id),
            itemName: r.itemName,
            modelName: r.modelName,
            bidId: r.bidId,
          });
          try {
            await withdrawBid(cookieHeader, String(id), region, r.bidId);
            cancelled += 1;
            emit({ type: 'bid-done', shopId: String(id), bidId: r.bidId, itemName: r.itemName, ok: true });
          } catch (e) {
            failed += 1;
            emit({ type: 'bid-done', shopId: String(id), bidId: r.bidId, itemName: r.itemName, ok: false, msg: e.message });
          }
          await sleep(WITHDRAW_DELAY_MS);
        }
        emit({ type: 'shop-done', shopId: String(id), name, ok: true, cancelled, failed, msg: '' });
        results.push({ shopId: String(id), name, ok: true, cancelled, failed });
      } catch (e) {
        emit({ type: 'shop-done', shopId: String(id), name, ok: false, cancelled: 0, failed: 0, msg: e.message });
        results.push({ shopId: String(id), name, ok: false, cancelled: 0, failed: 0, msg: e.message });
      }
    }
    emit({
      type: 'summary',
      cancelled: results.reduce((n, r) => n + (r.cancelled || 0), 0),
      failed: results.reduce((n, r) => n + (r.failed || 0), 0),
      success: results.filter(r => r.ok).length,
      total: results.length,
    });
    try { res.end(); } catch { /* ignore */ }
  })().catch((e) => {
    try { emit({ type: 'fatal', msg: `撤销失败：${e.message}` }); res.end(); } catch { /* ignore */ }
  });
}

// ============ 路由注册 ============
function register({ post }) {
  post('/api/bidding-cancel/preview', async (req, res) => {
    let parsed = {};
    try { parsed = JSON.parse(await readBody(req)); } catch (e) { console.warn('解析 /api/bidding-cancel/preview 请求体失败:', e.message); }
    handlePreview(parsed, res);
  });

  post('/api/bidding-cancel/run', async (req, res) => {
    let parsed = {};
    try { parsed = JSON.parse(await readBody(req)); } catch (e) { console.warn('解析 /api/bidding-cancel/run 请求体失败:', e.message); }
    handleRun(parsed, res);
  });
}

module.exports = { register, fetchImprovementBids, withdrawBid, extractImprovementItems, toAmount };
