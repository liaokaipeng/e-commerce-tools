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
const { sendJson, sse, readJsonBodySoft, readRouteBody } = require('./lib/http-utils');
// 会话 / Cookie / 店铺列表 / 金额换算 / 延时 / 接口请求层：与竞价导出、取消Hot Listing、商品导出共用
const {
  DEFAULT_REGION, toAmount, sleep, loadCookieHeader, loadStores,
  apiPost, buildShopeeUrl, fetchShopRegion,
} = require('./lib/shopee-session');
// 长任务注册中心：暂停 / 继续 / 取消 / SSE 断开即取消 / 僵尸清理
const jobs = require('./lib/jobs');

// 待改进 Tab 的 page_tab 值（page_tab=1 为「进行中的竞价」全部，2 为其中「待改进」）
const PAGE_TAB_IMPROVE = 2;
// 逐条撤销之间的间隔，避免请求过快触发风控
const WITHDRAW_DELAY_MS = 300;

// ============ Shopee 接口链路（请求层见 lib/shopee-session.js） ============

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
  const url = buildShopeeUrl('/api/mkt/bidding/get_item_ongoing_list', { shopId, region });
  const rows = [];
  let pageNum = 1;
  while (true) {
    const j = await apiPost(url, cookieHeader, {
      filter: { page_tab: PAGE_TAB_IMPROVE },
      page_info: { page_num: pageNum, page_size: 100 },
      option: { with_performance: true },
    }, { label: '获取待改进列表' });
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
  const url = buildShopeeUrl('/api/mkt/bidding/seller_withdraw', { shopId, region });
  return apiPost(url, cookieHeader, { bid_id: String(bidId) }, { label: '撤销竞价' });
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
      const region = (await fetchShopRegion(cookieHeader, String(id))) || DEFAULT_REGION;
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
  // SSE 客户端断开（用户关掉页面）即视为取消，任务在下个门控点退出
  let clientGone = false;
  if (typeof res.on === 'function') res.on('close', () => { clientGone = true; });
  const jobId = jobs.create();

  (async () => {
    const stores = loadStores();
    let cookieHeader;
    try {
      cookieHeader = loadCookieHeader();
    } catch (e) {
      jobs.finish(jobId);
      emit({ type: 'fatal', msg: e.message });
      res.end();
      return;
    }
    // 先下发 jobId，前端据此发暂停 / 继续 / 取消指令
    emit({ type: 'start', jobId });

    const results = [];
    let cancelledByUser = false;
    try {
      for (const id of shopIds) {
        await jobs.checkpoint(jobId, () => clientGone);
        const store = stores.find(s => s.id === String(id));
        const name = store ? store.name : String(id);
        emit({ type: 'shop-start', shopId: String(id), name });
        try {
          const region = (await fetchShopRegion(cookieHeader, String(id))) || DEFAULT_REGION;
          // 实时拉取最新待改进列表（预览后状态可能已变化）
          const rows = await fetchImprovementBids(cookieHeader, String(id), region);
          let cancelled = 0;
          let failed = 0;
          for (const r of rows) {
            await jobs.checkpoint(jobId, () => clientGone);
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
    } catch (e) {
      if (!(e instanceof jobs.CancelledError)) throw e;
      cancelledByUser = true;
    }

    jobs.finish(jobId);
    emit({
      type: cancelledByUser ? 'cancelled' : 'summary',
      cancelled: results.reduce((n, r) => n + (r.cancelled || 0), 0),
      failed: results.reduce((n, r) => n + (r.failed || 0), 0),
      success: results.filter(r => r.ok).length,
      total: results.length,
    });
    try { res.end(); } catch { /* ignore */ }
  })().catch((e) => {
    jobs.finish(jobId);
    try { emit({ type: 'fatal', msg: `撤销失败：${e.message}` }); res.end(); } catch { /* ignore */ }
  });
}

// ============ 路由注册 ============
function register({ post }) {
  post('/api/bidding-cancel/preview', async (req, res) => {
    const parsed = await readJsonBodySoft(req, '/api/bidding-cancel/preview');
    handlePreview(parsed, res);
  });

  post('/api/bidding-cancel/run', async (req, res) => {
    const parsed = await readJsonBodySoft(req, '/api/bidding-cancel/run');
    handleRun(parsed, res);
  });

  // 暂停 / 继续 / 取消执行中的任务（body { jobId }，jobId 由 run 的 start 事件下发）
  post('/api/bidding-cancel/pause', async (req, res) => {
    const parsed = await readRouteBody(req, '/api/bidding-cancel/pause', { res });
    if (!parsed) return;
    const ok = jobs.setPaused(parsed.jobId, true);
    sendJson(res, ok ? 200 : 404, ok ? { ok: true } : { ok: false, msg: '任务不存在或已结束' });
  });

  post('/api/bidding-cancel/resume', async (req, res) => {
    const parsed = await readRouteBody(req, '/api/bidding-cancel/resume', { res });
    if (!parsed) return;
    const ok = jobs.setPaused(parsed.jobId, false);
    sendJson(res, ok ? 200 : 404, ok ? { ok: true } : { ok: false, msg: '任务不存在或已结束' });
  });

  post('/api/bidding-cancel/cancel', async (req, res) => {
    const parsed = await readRouteBody(req, '/api/bidding-cancel/cancel', { res });
    if (!parsed) return;
    const ok = jobs.cancel(parsed.jobId, '用户取消');
    sendJson(res, ok ? 200 : 404, ok ? { ok: true } : { ok: false, msg: '任务不存在或已结束' });
  });
}

module.exports = { register, fetchImprovementBids, withdrawBid, extractImprovementItems, toAmount };
