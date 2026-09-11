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
const { sendJson, sse, readJsonBodySoft } = require('./lib/http-utils');
// 长任务注册中心（暂停 / 继续 / 取消 / SSE 断开即取消 / TTL 清理）：与取消竞价共用
const jobs = require('./lib/jobs');
// 会话 / Cookie / 店铺列表 / 延时 / 接口请求层：与竞价导出、取消竞价、商品导出共用同一实现
const {
  HOST, DEFAULT_REGION, sleep, loadCookie, loadStores,
  apiPost, buildShopeeUrl, fetchShopRegion,
} = require('./lib/shopee-session');

// 各店铺 SPU ID 配置（shopId -> SPU 文本，每行一个），持久化保存
const SPU_CONFIG_FILE = path.join(__dirname, 'data', 'hotlisting-spu.json');
const RSKU_STATUS_ENROLLED = 2;   // search_filter.rsku_status=2 即「已注册」
const PAGE_LIMIT = 20;            // 单页条数（抓包实测 8 可用；适度放大减少请求次数）
const MAX_PAGES = 200;            // 翻页上限（防死循环）
// 逐条取消注册之间的间隔，避免请求过快触发风控
const CANCEL_DELAY_MS = 300;

// ============ Shopee 接口链路（URL 拼接与请求层见 lib/shopee-session.js） ============

/** 获取店铺市场（cbsc_shop_region），取不到时按 DEFAULT_REGION 继续（buybox 接口必须带该参数） */
async function regionOf(cookie, shopId) {
  return (await fetchShopRegion(cookie.header, shopId)) || DEFAULT_REGION;
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
  const url = buildShopeeUrl('/api/mkt/buybox/get_rsku_vsku_list', { shopId, region, spcCds: cookie.spcCds });
  const referer = `${HOST}/portal/marketing/cmt-buy-box?spuId=${spuId}&trackerSource=1&cnsc_shop_id=${shopId}`;
  const rows = [];
  let offset = 0;
  for (let page = 1; page <= MAX_PAGES; page++) {
    const j = await apiPost(url, cookie.header, {
      from_condition: { spu_id: Number(spuId) },
      search_filter: { rsku_status: RSKU_STATUS_ENROLLED, item_name: '' },
      page_info: { offset, limit: PAGE_LIMIT },
    }, { referer, label: `获取 SPU ${spuId} 已注册列表` });
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
  const url = buildShopeeUrl('/api/mkt/buybox/update_enroll', { shopId, region, spcCds: cookie.spcCds });
  return apiPost(url, cookie.header, {
    rsku_id: Number(rskuId),
    vsku_id: Number(vskuId),
    seller_decision: 0,
  }, { label: `取消注册 SKU ${rskuId}` });
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
      const region = await regionOf(cookie, String(id));
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
  // SSE 客户端断开（用户关掉页面）即视为取消：任务在下个门控点退出，不再空跑。
  let clientGone = false;
  req_onClose(res, () => { clientGone = true; });
  const jobId = jobs.create();

  (async () => {
    const stores = loadStores();
    let cookie;
    try {
      cookie = loadCookie();
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
          const region = await regionOf(cookie, String(id));
          for (const spuId of plan.spus) {
            await jobs.checkpoint(jobId, () => clientGone);
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
              await jobs.checkpoint(jobId, () => clientGone);
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
    } catch (e) {
      // 取消（用户点取消 / SSE 断开）走这里：已处理的部分照常汇总，不再继续后续店铺
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
    try { emit({ type: 'fatal', msg: `取消注册失败：${e.message}` }); res.end(); } catch { /* ignore */ }
  });
}

/** 监听响应连接关闭（SSE 客户端断开兜底；已结束时不重复触发） */
function req_onClose(res, fn) {
  if (typeof res.on !== 'function') return;
  res.on('close', fn);
}

// ============ 路由注册 ============
function register({ get, post }) {
  // 各店铺 SPU 配置：读取 / 保存（前端编辑后自动保存）
  get('/api/hotlisting-cancel/spu-config', async (req, res, query) => {
    sendJson(res, 200, { ok: true, map: loadSpuConfig() });
  });

  post('/api/hotlisting-cancel/spu-config', async (req, res) => {
    const parsed = await readJsonBodySoft(req, '/api/hotlisting-cancel/spu-config');
    try {
      const map = normalizeSpuMap(parsed.map);
      saveSpuConfig(map);
      sendJson(res, 200, { ok: true, map });
    } catch (e) {
      sendJson(res, 500, { ok: false, msg: '保存 SPU 配置失败：' + e.message });
    }
  });

  post('/api/hotlisting-cancel/preview', async (req, res) => {
    const parsed = await readJsonBodySoft(req, '/api/hotlisting-cancel/preview');
    handlePreview(parsed, res);
  });

  post('/api/hotlisting-cancel/run', async (req, res) => {
    const parsed = await readJsonBodySoft(req, '/api/hotlisting-cancel/run');
    handleRun(parsed, res);
  });

  // 暂停 / 继续 / 取消执行中的任务（body { jobId }，jobId 由 run 的 start 事件下发）
  // 三个路由的样板与 404 语义统一由 lib/jobs.registerControlRoutes 提供
  jobs.registerControlRoutes(post, '/api/hotlisting-cancel');
}

module.exports = { register, parseSpuList, extractEnrolledSkus, fetchEnrolledSkus, unenrollSku, normalizeSpuMap, resolvePerShopSpus };
