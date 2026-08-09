/**
 * Shopee 实时竞价数据导出模块（CommonJS）
 * 由合并服务 main.js 引入，通过 register({ get, post }) 注册路由。
 * 登录 Cookie 由浏览器扩展推送至 /api/cookie，保存到本目录 bidding-session.json。
 */
const ExcelJS = require('exceljs');
const fs = require('fs');
const path = require('path');

const SESSION_FILE = path.join(__dirname, 'bidding-session.json');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

// ============ 店铺列表（分类 / 店铺简称 / 店铺 ID） ============
const STORES = [
  // ---- Shopee-DM ----
  { category: 'Shopee-DM', name: 'Shopee-DM-PH1店', id: '557630453' },
  { category: 'Shopee-DM', name: 'Shopee-DM-PH2店', id: '1377489803' },
  { category: 'Shopee-DM', name: 'Shopee-DM-PH3店', id: '953673451' },
  { category: 'Shopee-DM', name: 'Shopee-DM-MY1店', id: '595674837' },
  { category: 'Shopee-DM', name: 'Shopee-DM-MY2店', id: '1434986483' },
  { category: 'Shopee-DM', name: 'Shopee-DM-MY3店', id: '1510186427' },
  { category: 'Shopee-DM', name: 'Shopee-DM-VN1店', id: '1713972908' },
  { category: 'Shopee-DM', name: 'Shopee-DM-TH1店', id: '601642389' },
  // ---- Shopee-PC ----
  { category: 'Shopee-PC', name: 'Shopee-PC-越南', id: '772716966' },
  { category: 'Shopee-PC', name: 'Shopee-PC-菲律宾', id: '687713299' },
  { category: 'Shopee-PC', name: 'Shopee-PC-泰国', id: '753230225' },
  { category: 'Shopee-PC', name: 'Shopee-PC-马来西亚', id: '744794639' },
];

// ============ 登录状态 ============
function readSession() {
  if (!fs.existsSync(SESSION_FILE)) return null;
  try { return JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8')); }
  catch { return null; }
}

// ============ 数据抓取（纯 HTTP） ============
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

async function apiGet(cookieHeader, url) {
  const resp = await fetch(url, {
    headers: { 'Cookie': cookieHeader, 'User-Agent': UA, 'Accept': 'application/json' },
  });
  const text = await resp.text();
  if (resp.status === 403 || (text.includes('token not found'))) {
    throw new Error('登录已失效（403 token not found），请重新登录卖家中心并点扩展推送');
  }
  return JSON.parse(text);
}

async function apiPost(cookieHeader, url, body) {
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Cookie': cookieHeader, 'User-Agent': UA, 'Accept': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await resp.text();
  if (resp.status === 403 || (text.includes('token not found'))) {
    throw new Error('登录已失效（403 token not found），请重新登录卖家中心并点扩展推送');
  }
  return JSON.parse(text);
}

/** 金额：内部单位为"分"，除以 100000 得到实际金额 */
function toAmount(v) {
  if (v === null || v === undefined || v === '' || v === '0' || v === 0) return '';
  const n = Number(v) / 100000;
  return Math.round(n * 100) / 100;
}

async function fetchWinningData(cookieHeader, shopId, region) {
  const base = `https://seller.shopee.cn/api/mkt/bidding/get_item_ongoing_list?SPC_CDS_VER=2&cnsc_shop_id=${shopId}&cbsc_shop_region=${region}`;
  const rows = [];
  let pageNum = 1;
  let total = 0;
  while (true) {
    const j = await apiPost(cookieHeader, base, {
      filter: { page_tab: 3 },           // 3 = 获胜
      page_info: { page_num: pageNum, page_size: 100 },
      option: { with_performance: true },
    });
    if (j.code !== 0) throw new Error(`接口返回错误: code=${j.code} msg=${j.msg}`);
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

async function writeExcel(shopId, rows, outPath) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'bidding-export';
  const ws = wb.addWorksheet('获胜竞价');
  const headers = ['商品编号（外层商品）', '编号', '系统竞价价格', '最终价格', '我的最佳价格', '我的活动价格'];
  ws.addRow(headers);
  const headerRow = ws.getRow(1);
  headerRow.font = { bold: true };
  headerRow.alignment = { horizontal: 'center', vertical: 'middle' };
  for (const r of rows) {
    ws.addRow([r['商品编号'], r['编号'], r['系统竞价价格'], r['最终价格'], r['我的最佳价格'], r['我的活动价格']]);
  }
  ws.columns.forEach(col => { col.width = 20; });
  ws.getColumn(1).width = 18;
  ws.getColumn(2).width = 18;
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  await wb.xlsx.writeFile(outPath);
  return outPath;
}

/** 导出单个店铺，返回结果对象 */
async function exportShop(shopId) {
  const cookieHeader = loadCookieHeader();

  // 1. 获取店铺市场（cbsc_shop_region）
  let region = 'ph';
  try {
    const j = await apiGet(cookieHeader, `https://seller.shopee.cn/api/framework/selleraccount/shop_info/?SPC_CDS_VER=2&cnsc_shop_id=${shopId}`);
    if (j.code === 0 && j.data?.shop_region) region = j.data.shop_region.toLowerCase();
  } catch (e) {
    // 获取市场失败时默认 ph，继续导出
  }

  // 2. 拉取【获胜】数据
  const { rows, total } = await fetchWinningData(cookieHeader, shopId, region);

  // 3. 导出 Excel（文件名带时分秒，避免同日多次运行或文件被 Excel 占用导致冲突）
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  const ts = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  const out = path.join(__dirname, `竞价获胜_店铺${shopId}_${ts}.xlsx`);
  await writeExcel(shopId, rows, out);

  return { shopId, rows: rows.length, total, file: path.basename(out) };
}

// ============ 接收扩展 Cookie ============
function handleCookie(req, res) {
  let body = '';
  req.on('data', chunk => { body += chunk; });
  req.on('end', () => {
    try {
      const payload = JSON.parse(body);
      const cookies = payload.cookies || [];
      if (!cookies.length) {
        res.writeHead(400, { 'Content-Type': 'text/plain' });
        res.end('no cookies');
        return;
      }
      fs.writeFileSync(SESSION_FILE, JSON.stringify(payload, null, 2));
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('ok');
      console.log(`✅ 已收到 ${cookies.length} 个 Cookie，保存到 ${SESSION_FILE}`);
    } catch (e) {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end('bad json: ' + e.message);
    }
  });
}

// ============ 导出接口 ============
function handleExport(body, res) {
  (async () => {
    const shopIds = Array.isArray(body.shopIds) ? body.shopIds : [];
    if (shopIds.length === 0) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false, msg: '请先选择至少一个店铺' }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    const results = [];
    for (const id of shopIds) {
      const store = STORES.find(s => s.id === String(id));
      const name = store ? store.name : id;
      try {
        const r = await exportShop(String(id));
        res.write(`\n▶ ${name}（${id}）导出成功：${r.rows} 条 → ${r.file}`);
        results.push({ shopId: id, name, ok: true, rows: r.rows, file: r.file });
      } catch (e) {
        res.write(`\n✕ ${name}（${id}）失败：${e.message}`);
        results.push({ shopId: id, name, ok: false, msg: e.message });
      }
    }
    res.end(`\n\n完成：成功 ${results.filter(r => r.ok).length} / 共 ${results.length} 个店铺。`);
  })().catch(e => {
    try {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('导出失败：' + e.message);
    } catch { /* ignore */ }
  });
}

// ============ 路由注册 ============
function register({ get, post }) {
  get('/api/status', (req, res) => {
    const session = readSession();
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({
      loggedIn: !!(session && session.cookies && session.cookies.length),
      cookieCount: session?.cookies?.length || 0,
      savedAt: session?.savedAt || null,
    }));
  });

  get('/api/stores', (req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(STORES));
  });

  post('/api/export', (req, res) => {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      let parsed = {};
      try { parsed = JSON.parse(body); } catch {}
      handleExport(parsed, res);
    });
  });

  post('/api/cookie', (req, res) => {
    handleCookie(req, res);
  });
}

module.exports = { register, STORES };