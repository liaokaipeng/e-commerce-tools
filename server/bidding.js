/**
 * Shopee 实时竞价数据导出模块（CommonJS）
 * 由合并服务 main.js 引入，通过 register({ get, post }) 注册路由。
 * 登录 Cookie 由浏览器扩展推送至 /api/cookie，保存到本目录 bidding-session.json。
 */
const ExcelJS = require('exceljs');
const fs = require('fs');
const path = require('path');
const { sendJson, sse, readJsonBodySoft } = require('./lib/http-utils');
// 会话 / Cookie / 店铺名映射 / 金额换算 / 接口请求层：与取消竞价、取消Hot Listing 共用同一实现
const {
  SESSION_FILE, DEFAULT_REGION, toAmount, loadCookieHeader, loadStoreNames, storeNameOf, readSession,
  apiPost, buildShopeeUrl, fetchShopRegion,
} = require('./lib/shopee-session');
const { ensureDir, timestampText, styleExcelHeader } = require('./lib/export-utils');

// ============ 数据抓取（纯 HTTP，请求层见 lib/shopee-session.js） ============
async function fetchWinningData(cookieHeader, shopId, region) {
  const url = buildShopeeUrl('/api/mkt/bidding/get_item_ongoing_list', { shopId, region });
  const rows = [];
  let pageNum = 1;
  let total = 0;
  while (true) {
    const j = await apiPost(url, cookieHeader, {
      filter: { page_tab: 3 },           // 3 = 获胜
      page_info: { page_num: pageNum, page_size: 100 },
      option: { with_performance: true },
    }, { label: '获取获胜竞价列表' });
    const d = j.data;
    total = d.total_model_count;
    for (const item of d.list) {
      for (const model of item.model_list) {
        const b = model.bidding_info || {};
        rows.push({
          商品编号: String(item.item_id),
          编号: String(model.product_info?.model_id ?? ''),
          系统竞价价格: toAmount(b.bid_price),
          最终价格: toAmount(b.estimated_supply_price),
          我的最佳价格: toAmount(b.floor_price),
          我的活动价格: toAmount(b.ceiling_price),
        });
      }
    }
    if (!d.has_more) break;
    pageNum += 1;
    if (pageNum > 200) throw new Error('翻页超过 200 页，疑似死循环，已停止');
  }
  return { rows, total };
}

async function writeExcel(rows, outPath) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'bidding-export';
  const ws = wb.addWorksheet('获胜竞价');
  const headers = ['商品编号（外层商品）', '编号', '系统竞价价格', '最终价格', '我的最佳价格', '我的活动价格'];
  ws.addRow(headers);
  for (const r of rows) {
    ws.addRow([r['商品编号'], r['编号'], r['系统竞价价格'], r['最终价格'], r['我的最佳价格'], r['我的活动价格']]);
  }
  ws.columns.forEach(col => { col.width = 20; });
  ws.getColumn(1).width = 18;
  ws.getColumn(2).width = 18;
  styleExcelHeader(ws);
  await wb.xlsx.writeFile(outPath);
  return outPath;
}

/** 导出单个店铺，返回结果对象 */
async function exportShop(shopId, saveDir) {
  const cookieHeader = loadCookieHeader();

  // 1. 获取店铺市场（cbsc_shop_region），取不到按 DEFAULT_REGION 继续导出
  const region = (await fetchShopRegion(cookieHeader, shopId)) || DEFAULT_REGION;

  // 2. 拉取【获胜】数据
  const { rows, total } = await fetchWinningData(cookieHeader, shopId, region);

  // 3. 导出 Excel（保存到用户指定目录，缺省为系统下载目录；文件名带时分秒避免冲突）
  const outDir = ensureDir(saveDir);
  const out = path.join(outDir, `竞价获胜_店铺${shopId}_${timestampText()}.xlsx`);
  await writeExcel(rows, out);

  return { rows: rows.length, total, file: path.basename(out) };
}

// ============ 接收扩展 Cookie ============
// 注意：本接口是扩展（extension/popup.js）的对接协议，返回纯文本 'ok' / 错误说明，
// 与其余接口的 JSON 风格不同，改动需同步扩展判断逻辑。
async function handleCookie(req, res) {
  const payload = await readJsonBodySoft(req, '/api/cookie');
  const cookies = Array.isArray(payload.cookies) ? payload.cookies : [];
  if (!cookies.length) {
    res.writeHead(400, { 'Content-Type': 'text/plain' });
    res.end('no cookies');
    return;
  }
  try {
    fs.mkdirSync(path.dirname(SESSION_FILE), { recursive: true });
    fs.writeFileSync(SESSION_FILE, JSON.stringify(payload, null, 2));
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('ok');
    console.log(`✅ 已收到 ${cookies.length} 个 Cookie，保存到 ${SESSION_FILE}`);
  } catch (e) {
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('save failed: ' + e.message);
  }
}

// ============ 导出接口（SSE 流式事件） ============
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
    const storeNames = loadStoreNames();
    for (const id of shopIds) {
      const name = storeNameOf(id, storeNames);
      emit({ type: 'start', shopId: id, name });
      try {
        const r = await exportShop(String(id), saveDir);
        emit({ type: 'done', shopId: id, name, ok: true, rows: r.rows, total: r.total, file: r.file });
        results.push({ shopId: id, name, ok: true, rows: r.rows, file: r.file });
      } catch (e) {
        emit({ type: 'done', shopId: id, name, ok: false, msg: e.message });
        results.push({ shopId: id, name, ok: false, msg: e.message });
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

// ============ 路由注册 ============
function register({ get, post }) {
  get('/api/status', (req, res) => {
    const session = readSession();
    sendJson(res, 200, {
      loggedIn: !!(session && session.cookies && session.cookies.length),
      cookieCount: session?.cookies?.length || 0,
      savedAt: session?.savedAt || null,
    });
  });

  post('/api/export', async (req, res) => {
    const parsed = await readJsonBodySoft(req, '/api/export');
    handleExport(parsed, res);
  });

  post('/api/cookie', (req, res) => {
    handleCookie(req, res);
  });
}

module.exports = { register, toAmount };