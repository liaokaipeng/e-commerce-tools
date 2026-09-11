/**
 * Shopee 跨境店铺商品数据导出模块（CommonJS）
 * 由合并服务 main.js 引入，通过 register({ get, post }) 注册路由。
 * 与竞价导出共用同一份登录 Cookie（server/data/bidding-session.json，扩展推送保存）。
 *
 * 接口还原（接口不用 UI 自动化），复用卖家中心 v3 接口（生产实测 2026-08）：
 *   GET /api/v3/opt/mpsku/list/v2/get_product_list
 *       参数 page_number / page_size（蛇形命名；page_size 实测 ≥50 报 exceed limit，用 45；
 *       接口偶发返回 page_size+1 条，按商品 ID 去重），
 *       返回 data.products[]：商品 id/name/status/cover_image/parent_sku + 内嵌 model_list
 *       （model id / sku / tier_index / image 图片ID / 价格 / 库存 / 销量），翻页 data.page_info.total；
 *   GET /api/v3/product/get_product_info
 *       参数 product_id + is_draft=false，返回 data.product_info：
 *       tier_variation[]（规格名 name + 选项 options + 每个选项的规格图片 images[]）
 *       + model_list[]（完整规格：sku / 价格 / 各仓库存 / 重量体积）。
 * 公共查询参数：SPC_CDS_VER=2 & SPC_CDS=<Cookie 值> & cnsc_shop_id=<店铺ID>（与竞价接口一致）。
 * SKU 图片以列表接口 model.image 为准（详情接口 tier_variation.images 为规格值图片，可能滞后）。
 * 图片直链按店铺市场输出：https://down-{region}.img.susercontent.com/<image_id>
 * （与卖家中心/买家端一致，如 ph → down-ph；市场未知兜底 https://cf.shopee.sg/file/）。
 *
 * 导出结果：每一行是商品的一个规格（model），含商品 ID / 规格 ID / 规格信息（规格名+规格值+
 * 规格值图片链接）与 SKU 图片链接等字段，写入 .xlsx。
 */
const ExcelJS = require('exceljs');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { request } = require('./lib/http');
const { sendJson, sse, readJsonBodySoft } = require('./lib/http-utils');
// 会话 / Cookie / 卖家中心域名：与竞价导出、取消竞价、取消 Hot Listing 共用同一实现
const { HOST, UA, loadCookie, assertLoginOk } = require('./lib/shopee-session');

const API_LIST = '/api/v3/opt/mpsku/list/v2/get_product_list';
const API_INFO = '/api/v3/product/get_product_info';
const IMAGE_CDN = 'https://cf.shopee.sg/file/';
const PAGE_SIZE = 45;       // 列表单页规格数（实测 page_size ≥50 报 exceed limit，45 可用）
const CONCURRENCY = 3;      // 拉取商品详情的并发数（避免请求过快触发风控）
const MAX_PAGES = 200;      // 翻页上限（防死循环）

/** 拼 v3 接口 URL：公共参数 SPC_CDS_VER / SPC_CDS / cnsc_shop_id 统一附加 */
function buildUrl(apiPath, business, { cookie, shopId }) {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(business || {})) {
    if (v === null || v === undefined || v === '') continue;
    params.set(k, String(v));
  }
  params.set('SPC_CDS_VER', '2');
  if (cookie.spcCds) params.set('SPC_CDS', cookie.spcCds);
  params.set('cnsc_shop_id', String(shopId));
  return `${HOST}${apiPath}?${params.toString()}`;
}

async function apiGet(cookie, url) {
  const resp = await request({
    url,
    headers: {
      'Cookie': cookie.header,
      'User-Agent': UA,
      'Accept': 'application/json, text/plain, */*',
      'Origin': HOST,
      'Referer': `${HOST}/portal/product/list/all`,
    },
  });
  assertLoginOk(resp);
  const j = resp.json;
  if (!j || typeof j !== 'object') throw new Error('接口返回异常：' + (resp.text || '').slice(0, 120));
  if (j.code !== 0 && j.code !== undefined) {
    throw new Error(`接口错误 code=${j.code}：${j.msg || j.message || j.user_message || ''}`);
  }
  return j;
}

// ============ 纯函数（单测覆盖） ============

/**
 * 图片 ID → 直链（空值返回空串）。
 * 按店铺市场输出 `https://down-{region}.img.susercontent.com/{id}`（与买家端/卖家中心展示一致，
 * 如 ph → down-ph）；市场未知时兜底 cf.shopee.sg/file/（实测同样可访问）。
 */
function imageUrlOf(id, region) {
  const s = String(id || '').trim();
  if (!s) return '';
  if (/^https?:\/\//i.test(s)) return s;
  const r = String(region || '').toLowerCase().trim();
  if (r) return `https://down-${r}.img.susercontent.com/${s}`;
  return IMAGE_CDN + s;
}

/** 状态码 → 中文（v2 列表 status 实测 1=在售；其余原样保留，便于发现新枚举） */
function statusNameOf(status) {
  if (status === 1 || status === '1') return '在售';
  if (status === null || status === undefined || status === '') return '';
  return String(status);
}

/** 取字符串值（数值也转字符串），空返回 '' */
function strOf(v) {
  if (v === null || v === undefined) return '';
  return String(v);
}

/** 从候选字段里取第一个非空字符串 */
function firstStr(obj, keys) {
  for (const k of keys) {
    if (!obj || typeof obj !== 'object') continue;
    const v = obj[k];
    if (v !== null && v !== undefined && v !== '') return strOf(v);
  }
  return '';
}

/** 取商品列表里的商品数组（兼容 list/products/item 等多种字段名） */
function productsOf(json) {
  if (!json || typeof json !== 'object') return [];
  const data = json.data || json.response || json.result || {};
  for (const k of ['products', 'product_list', 'list', 'items', 'item']) {
    if (Array.isArray(data[k])) return data[k];
  }
  return [];
}

/** 商品总条数（page_info.total 兜底 total_count/total） */
function totalOf(json) {
  const data = (json && json.data) || {};
  const pi = data.page_info || data.pageInfo || {};
  for (const v of [pi.total, data.total_count, data.total, json.total]) {
    const n = Number(v);
    if (isFinite(n) && v !== null && v !== undefined && v !== '') return n;
  }
  return 0;
}

/** 商品详情里的规格定义数组（tier_variation / tier_variations / tier_variation_list） */
function tiersOf(detail) {
  if (!detail || typeof detail !== 'object') return [];
  for (const k of ['tier_variation', 'tier_variations', 'tier_variation_list', 'std_tier_variation_list']) {
    if (Array.isArray(detail[k]) && detail[k].length) return detail[k];
  }
  return [];
}

/** 单条规格定义 → 选项数组（options / option_list / value_list / custom 兜底） */
function optionsOf(tier) {
  if (!tier || typeof tier !== 'object') return [];
  for (const k of ['options', 'option_list', 'optionList', 'value_list']) {
    if (Array.isArray(tier[k])) return tier[k];
  }
  return [];
}

/** 规格定义里的规格图片 ID 数组（images / image_list，与选项按下标对应） */
function tierImagesOf(tier) {
  if (!tier || typeof tier !== 'object') return [];
  for (const k of ['images', 'image_list', 'imageList']) {
    if (Array.isArray(tier[k])) return tier[k];
  }
  return [];
}

/** 规格选项 → 显示文本（字符串直接返回；对象取 option/custom_value/value/name） */
function optionTextOf(opt) {
  if (opt === null || opt === undefined) return '';
  if (typeof opt === 'string' || typeof opt === 'number') return strOf(opt);
  if (typeof opt === 'object') {
    return firstStr(opt, ['option', 'custom_value', 'customValue', 'value', 'name']);
  }
  return '';
}

/** 规格选项 → 图片 ID（对象取 image_id/image，字符串选项回退到 tier.images 下标） */
function optionImageIdOf(opt, tier, idx) {
  if (opt && typeof opt === 'object') {
    const v = firstStr(opt, ['image_id', 'imageId', 'image']);
    if (v) return v;
    if (opt.image && typeof opt.image === 'object') return firstStr(opt.image, ['image_id', 'imageId']);
  }
  const imgs = tierImagesOf(tier);
  if (Array.isArray(imgs) && idx >= 0 && idx < imgs.length) {
    const v = imgs[idx];
    if (typeof v === 'string') return v;
    if (v && typeof v === 'object') return firstStr(v, ['image_id', 'imageId', 'image']);
  }
  return '';
}

/** 商品里的规格数组（model_list / models / model） */
function modelsOf(product) {
  if (!product || typeof product !== 'object') return [];
  for (const k of ['model_list', 'models', 'modelList', 'model']) {
    if (Array.isArray(product[k])) return product[k];
  }
  return [];
}

/** 规格（model）的库存：stock_detail.total_available_stock 兜底 stock/normal_stock */
function stockOf(model) {
  const sd = model && (model.stock_detail || model.stockDetail);
  if (sd && typeof sd === 'object') {
    const v = firstStr(sd, ['total_available_stock', 'available_stock', 'stock']);
    if (v !== '') return v;
  }
  return firstStr(model, ['stock', 'normal_stock']);
}

/** 规格（model）的价格：优先详情 price_info，兜底列表 price_detail */
function priceOf(model, keys) {
  const pi = model && (model.price_info || model.priceInfo);
  if (pi && typeof pi === 'object') {
    const v = firstStr(pi, keys);
    if (v !== '') return v;
  }
  const pd = model && (model.price_detail || model.priceDetail);
  if (pd && typeof pd === 'object') {
    const v = firstStr(pd, keys);
    if (v !== '') return v;
  }
  return '';
}

/** 详情里的规格定义表：specName(i) / specOption(i,j) / specImageId(i,j) */
function tierTableOf(detail) {
  const tiers = tiersOf(detail);
  return {
    count: tiers.length,
    name: (i) => (tiers[i] && tiers[i].name) || '',
    option: (i, j) => optionTextOf(optionsOf(tiers[i])[j]),
    imageId: (i, j) => {
      const opts = optionsOf(tiers[i]);
      return optionImageIdOf(opts[j], tiers[i], j);
    },
  };
}

/**
 * 把「列表商品 + 详情（可空）」展开成规格行（纯函数）。
 * 每一行是一个 model：商品字段 + 规格字段 + 动态「规格N名称/规格N值/规格N图片链接」+ SKU图片链接。
 * SKU 图片以列表接口的 model.image 为准（卖家中心列表页展示的 SKU 图，权威），
 * 详情接口 tier_variation.images 为规格值图片（可能滞后），仅作兜底。
 * @param {object} product 列表接口的单个商品
 * @param {object|null} detail 详情接口的 product_info（无则规格名留空，仅保留 SKU 图片兜底）
 * @param {string} shopId 店铺 ID
 * @param {string} region 店铺市场（ph/my/vn/th…，用于图片链接域名 down-{region}）
 * @returns {array} 行对象数组（动态 tier 键：tierName{i} / tierValue{i} / tierImage{i}）
 */
function buildRows(product, detail, shopId, region) {
  if (!product || typeof product !== 'object') return [];
  const itemId = firstStr(product, ['id', 'item_id', 'itemId', 'product_id']);
  const itemName = firstStr(product, ['name', 'item_name', 'itemName']);
  const status = product.status !== undefined ? statusNameOf(product.status) : '';
  const parentSku = firstStr(product, ['parent_sku', 'parentSku']);
  const cover = imageUrlOf(firstStr(product, ['cover_image', 'coverImage', 'image', 'image_url']), region);
  const table = tierTableOf(detail);
  const detailModels = detail && Array.isArray(detail.model_list) ? detail.model_list : [];
  const detailById = new Map(detailModels.map(m => [firstStr(m, ['id', 'model_id', 'modelId']), m]));
  const listModels = modelsOf(product);

  // 规格名缺失时（无详情）按列表 model.tier_index 推断最多 tier 数
  let maxTier = table.count;
  if (maxTier === 0) {
    for (const m of listModels) {
      const ti = m && (m.tier_index || m.tierIndex);
      if (Array.isArray(ti)) maxTier = Math.max(maxTier, ti.length);
    }
  }

  const rows = [];
  for (const lm of listModels) {
    const modelId = firstStr(lm, ['id', 'model_id', 'modelId']);
    const dm = detailById.get(modelId) || null;
    const src = dm || lm; // 优先详情字段（价格/库存更完整）
    const tierIndex = Array.isArray(src.tier_index) ? src.tier_index
      : Array.isArray(dm && dm.tier_index) ? dm.tier_index : [];

    const row = {
      shopId: strOf(shopId),
      itemId,
      itemName,
      status,
      parentSku,
      cover,
      detailUrl: itemId ? `${HOST}/portal/product/${itemId}` : '',
      modelId,
      modelName: firstStr(src, ['name', 'model_name']) || firstStr(lm, ['name', 'model_name']),
      sku: firstStr(src, ['sku', 'model_sku', 'modelSku']) || firstStr(lm, ['sku', 'model_sku', 'modelSku']),
      normalPrice: priceOf(src, ['input_normal_price', 'normal_price', 'origin_price']),
      promoPrice: priceOf(src, ['input_promotion_price', 'promotion_price']),
      stock: stockOf(src) || stockOf(lm),
      sold: firstStr(src, ['sold', 'sold_count', 'soldCount'])
        || firstStr(src.statistics || {}, ['sold_count', 'soldCount'])
        || firstStr(lm, ['sold', 'sold_count', 'soldCount'])
        || firstStr(lm.statistics || {}, ['sold_count', 'soldCount']),
      updateTime: strOf(firstStr(product, ['modify_time', 'update_time', 'modifyTime'])),
    };

    // 动态规格列：规格i名称 / 规格i值 / 规格i图片链接
    for (let i = 0; i < maxTier; i++) {
      const ti = Array.isArray(tierIndex) ? tierIndex[i] : null;
      const optIdx = ti == null ? null : Number(ti);
      const has = optIdx !== null && isFinite(optIdx) && optIdx >= 0;
      row[`tierName${i + 1}`] = table.count > i ? table.name(i) : '';
      row[`tierValue${i + 1}`] = has && table.count > i ? table.option(i, optIdx) : '';
      row[`tierImage${i + 1}`] = has && table.count > i ? imageUrlOf(table.imageId(i, optIdx), region) : '';
    }

    // SKU 图片链接：优先列表 model.image（卖家中心展示的权威 SKU 图），
    // 缺失时兜底该规格参与的规格值图片（第一个非空）
    const listModelImage = imageUrlOf(firstStr(lm, ['image', 'model_image', 'modelImage']), region);
    let skuImage = listModelImage;
    if (!skuImage) {
      for (let i = 0; i < maxTier && !skuImage; i++) {
        skuImage = row[`tierImage${i + 1}`] || '';
      }
    }
    row.skuImage = skuImage;
    rows.push(row);
  }
  return rows;
}

/** 行对象 → Excel 单元格数组（列顺序与 headerCells 一致） */
function rowToCells(row, maxTiers) {
  const cells = [
    row.shopId, row.itemId, row.itemName, row.status, row.parentSku,
    row.cover, row.detailUrl, row.modelId, row.modelName, row.sku,
    row.normalPrice, row.promoPrice, row.stock, row.sold, timeText(row.updateTime),
  ];
  for (let i = 1; i <= maxTiers; i++) {
    cells.push(row[`tierName${i}`] || '', row[`tierValue${i}`] || '', row[`tierImage${i}`] || '');
  }
  cells.push(row.skuImage || '');
  return cells;
}

/** Excel 表头（与 rowToCells 对齐） */
function headerCells(maxTiers) {
  const heads = [
    '店铺ID', '商品ID', '商品名称', '商品状态', '卖家商品编码', '商品主图链接',
    '商品链接(卖家中心)', '规格ID', '规格名称', '卖家SKU', '原价(元)', '活动价(元)',
    '库存', '销量', '更新时间',
  ];
  for (let i = 1; i <= maxTiers; i++) {
    heads.push(`规格${i}名称`, `规格${i}值`, `规格${i}图片链接`);
  }
  heads.push('SKU图片链接');
  return heads;
}

/** 秒级时间戳 → 本地时间字符串（空/非法返回空串） */
function timeText(v) {
  const n = Number(v);
  if (!isFinite(n) || n <= 0) return '';
  return new Date(n * 1000).toLocaleString('zh-CN', { hour12: false });
}

// ============ 数据抓取 ============

/** 翻页拉取商品列表（含内嵌 model_list）；按商品 ID 去重（接口偶发多返回一条） */
async function fetchProductList(cookie, shopId, emit) {
  const products = [];
  const seen = new Set();
  const addProduct = (p) => {
    const id = firstStr(p, ['id', 'item_id', 'itemId', 'product_id']);
    if (id && seen.has(id)) return;
    if (id) seen.add(id);
    products.push(p);
  };
  for (let page = 1; page <= MAX_PAGES; page++) {
    const url = buildUrl(API_LIST, { page_number: page, page_size: PAGE_SIZE }, { cookie, shopId });
    const j = await apiGet(cookie, url);
    const list = productsOf(j);
    list.forEach(addProduct);
    const total = totalOf(j);
    if (emit && (page === 1 || page % 10 === 0)) {
      emit({ type: 'list', shopId, got: products.length, total });
    }
    if (list.length < PAGE_SIZE || (total > 0 && products.length >= total)) break;
  }
  return products;
}

/** 拉取单个商品详情（失败返回 null，由调用方降级为列表数据） */
async function fetchProductInfo(cookie, shopId, productId) {
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const url = buildUrl(API_INFO, { product_id: productId, is_draft: false }, { cookie, shopId });
      const j = await apiGet(cookie, url);
      return (j.data && j.data.product_info) || null;
    } catch (e) {
      if (attempt === 2) {
        console.warn(`拉取商品 ${productId} 详情失败（已重试）: ${e.message}`);
        return null;
      }
    }
  }
  return null;
}

/** 并发小池：把任务数组以固定并发跑完（结果保持顺序） */
async function pool(tasks, concurrency, worker) {
  const results = new Array(tasks.length);
  let next = 0;
  async function run() {
    while (true) {
      const i = next++;
      if (i >= tasks.length) return;
      try { results[i] = await worker(tasks[i], i); }
      catch (e) { results[i] = { error: e }; }
    }
  }
  const workers = [];
  for (let w = 0; w < Math.min(concurrency, tasks.length); w++) workers.push(run());
  await Promise.all(workers);
  return results;
}

async function writeExcel(rows, outPath) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'product-export';
  const ws = wb.addWorksheet('商品规格');
  let maxTiers = 0;
  for (const r of rows) {
    let n = 0;
    while (r[`tierName${n + 1}`] !== undefined || r[`tierValue${n + 1}`] !== undefined) n++;
    maxTiers = Math.max(maxTiers, n);
  }
  ws.addRow(headerCells(maxTiers));
  const headerRow = ws.getRow(1);
  headerRow.font = { bold: true };
  headerRow.alignment = { horizontal: 'center', vertical: 'middle' };
  for (const r of rows) ws.addRow(rowToCells(r, maxTiers));
  ws.columns.forEach(col => { col.width = 18; });
  ws.getColumn(3).width = 60;   // 商品名称
  ws.getColumn(7).width = 45;   // 商品链接
  ws.getColumn(9).width = 22;   // 规格名称
  ws.getColumn(10).width = 30;  // 卖家SKU
  // 图片链接列加宽（商品主图/商品链接 + 各规格图片 + SKU 图片）
  const imgCols = [6, 7];
  for (let i = 1; i <= maxTiers; i++) imgCols.push(15 + 3 * i); // 规格i图片链接列 = 15 + 3i
  imgCols.push(15 + 3 * maxTiers + 1); // SKU图片链接列
  for (const c of imgCols) ws.getColumn(c).width = 60;
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  await wb.xlsx.writeFile(outPath);
  return outPath;
}

/** 获取店铺市场（shop_info 接口返回 shop_region，如 ph/my/vn），失败返回空串（图片链接走兜底域名） */
async function fetchShopRegion(cookie, shopId) {
  try {
    const j = await apiGet(cookie, `${HOST}/api/framework/selleraccount/shop_info/?SPC_CDS_VER=2&cnsc_shop_id=${shopId}`);
    const d = j && (j.data || j.result);
    if (j && j.code === 0 && d && d.shop_region) return String(d.shop_region).toLowerCase();
  } catch (e) {
    console.warn(`获取店铺 ${shopId} 市场失败: ${e.message}`);
  }
  return '';
}

/** 导出单个店铺：市场 → 列表 → 逐商品详情 → 规格行 → xlsx */
async function exportShop(shopId, saveDir, emit) {
  const cookie = loadCookie();
  emit({ type: 'start', shopId });

  // 店铺市场决定图片链接域名（down-{region}.img.susercontent.com）
  const region = await fetchShopRegion(cookie, shopId);
  emit({ type: 'region', shopId, region });

  const products = await fetchProductList(cookie, shopId, emit);
  if (products.length === 0) {
    throw new Error(`店铺 ${shopId} 没有拉取到商品数据`);
  }
  emit({ type: 'list', shopId, got: products.length, total: products.length });

  const details = await pool(products, CONCURRENCY, async (p, i) => {
    const productId = firstStr(p, ['id', 'item_id', 'itemId', 'product_id']);
    const detail = productId ? await fetchProductInfo(cookie, shopId, productId) : null;
    if (i % 25 === 0 || i === products.length - 1) {
      emit({ type: 'progress', shopId, done: i + 1, total: products.length });
    }
    return detail;
  });

  const rows = [];
  let detailOk = 0;
  for (let i = 0; i < products.length; i++) {
    const detail = details[i] && !details[i].error ? details[i] : null;
    if (detail) detailOk += 1;
    rows.push(...buildRows(products[i], detail, shopId, region));
  }

  const outDir = (saveDir || '').trim() || path.join(os.homedir(), 'Downloads');
  try { fs.mkdirSync(outDir, { recursive: true }); }
  catch (e) { throw new Error('无法创建保存目录：' + e.message); }
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  const ts = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  const out = path.join(outDir, `商品规格_店铺${shopId}_${ts}.xlsx`);
  await writeExcel(rows, out);
  return { rows: rows.length, total: products.length, detailOk, file: path.basename(out) };
}

// ============ 路由 ============
function handleExport(body, res) {
  const shopIds = Array.isArray(body.shopIds) ? body.shopIds : [];
  const saveDir = String(body.dir || '').trim();
  if (shopIds.length === 0) {
    sendJson(res, 400, { ok: false, msg: '请先选择至少一个店铺' });
    return;
  }
  const emit = sse(res);

  (async () => {
    const results = [];
    for (const id of shopIds) {
      emit({ type: 'start', shopId: id });
      try {
        const r = await exportShop(String(id), saveDir, emit);
        emit({ type: 'done', shopId: id, ok: true, rows: r.rows, total: r.total, file: r.file });
        results.push({ shopId: id, ok: true, rows: r.rows, file: r.file });
      } catch (e) {
        emit({ type: 'done', shopId: id, ok: false, msg: e.message });
        results.push({ shopId: id, ok: false, msg: e.message });
      }
    }
    emit({
      type: 'summary',
      success: results.filter(r => r.ok).length,
      failed: results.filter(r => !r.ok).length,
      total: results.length,
    });
    try { res.end(); } catch { /* ignore */ }
  })().catch((e) => {
    try { emit({ type: 'fatal', msg: `导出失败：${e.message}` }); res.end(); } catch { /* ignore */ }
  });
}

function register({ post }) {
  post('/api/product-export/export', async (req, res) => {
    const parsed = await readJsonBodySoft(req, '/api/product-export/export');
    handleExport(parsed, res);
  });
}

module.exports = {
  register,
  exportShop,
  // 纯函数（单测覆盖）
  imageUrlOf,
  statusNameOf,
  firstStr,
  productsOf,
  totalOf,
  tiersOf,
  optionsOf,
  tierImagesOf,
  optionTextOf,
  optionImageIdOf,
  modelsOf,
  stockOf,
  priceOf,
  tierTableOf,
  buildRows,
  rowToCells,
  headerCells,
  timeText,
};
