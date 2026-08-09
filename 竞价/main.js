/**
 * Shopee 实时竞价数据导出工具
 *
 * 用法：
 *   node main.js login                          # 启动本地服务，在浏览器扩展中点击发送 Cookie
 *   node main.js export -s 557630453            # 输入店铺 ID，导出获胜竞价数据到 Excel
 *   node main.js export -s 557630453 -o 结果.xlsx
 *
 * 原理：
 *   - login：本地 HTTP 服务接收浏览器扩展（extension/ 目录）读取的登录 Cookie（含 HttpOnly），保存到 session.json
 *   - export：直接用 HTTP 请求调用卖家中心内部接口（非 UI 自动化），翻页拉取全部数据
 */
import http from 'node:http';
import readline from 'node:readline/promises';
import ExcelJS from 'exceljs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SESSION_FILE = path.join(__dirname, 'session.json');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const SERVER_PORT = 8765;

// ============ 登录（接收扩展 Cookie） ============
function startCookieServer(onCookie) {
  const server = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
    if (req.method === 'POST' && req.url === '/api/cookie') {
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
          if (onCookie) {
            onCookie(cookies);
          } else {
            setTimeout(() => { server.close(); process.exit(0); }, 800);
          }
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'text/plain' });
          res.end('bad json: ' + e.message);
        }
      });
    } else {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('not found');
    }
  });

  server.on('error', (e) => {
    if (e.code === 'EADDRINUSE') {
      console.error(`端口 ${SERVER_PORT} 已被占用，可能已有登录服务在运行。请先关闭后重试。`);
    } else {
      console.error('本地服务启动失败:', e.message);
    }
    process.exit(1);
  });

  server.listen(SERVER_PORT, '127.0.0.1', () => {
    console.log('本地服务已启动: http://127.0.0.1:' + SERVER_PORT);
    console.log('请打开浏览器，点击扩展 [Shopee 竞价导出助手] 图标 → [发送登录信息到本地工具]');
    console.log('（需先安装扩展：edge://extensions → 开发人员模式 → 加载解压缩的扩展 → 选择 extension 文件夹）');
    console.log('等待 5 分钟...');
  });

  setTimeout(() => {
    console.log('等待超时（5 分钟），已退出。请重新运行再试。');
    server.close();
    process.exit(1);
  }, 5 * 60 * 1000);
}

// ============ 数据抓取（纯 HTTP） ============
function loadCookieHeader(targetDomain = 'seller.shopee.cn') {
  if (!fs.existsSync(SESSION_FILE)) {
    console.error('未找到 session.json，请先执行：node main.js login');
    process.exit(1);
  }
  const { cookies } = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8'));
  if (!cookies || cookies.length === 0) {
    console.error('session.json 中没有 Cookie，请重新执行：node main.js login');
    process.exit(1);
  }
  // 按 cookie 域匹配规则过滤：仅携带请求域自身或其子域可用的 cookie
  const matched = cookies.filter(c => {
    const d = String(c.domain || '').toLowerCase();
    if (!d) return false;
    const base = d.startsWith('.') ? d.slice(1) : d;  // 去前导点
    return targetDomain === base || targetDomain.endsWith('.' + base);
  });
  if (matched.length === 0) {
    console.error('没有匹配 seller.shopee.cn 的 Cookie，请重新执行：node main.js login');
    process.exit(1);
  }
  return matched.map(c => `${c.name}=${c.value}`).join('; ');
}

async function apiGet(cookieHeader, url) {
  const resp = await fetch(url, {
    headers: { 'Cookie': cookieHeader, 'User-Agent': UA, 'Accept': 'application/json' },
  });
  const text = await resp.text();
  if (resp.status === 403 || (text.includes('token not found'))) {
    throw new Error('登录已失效（403 token not found），请重新执行：node main.js login');
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
    throw new Error('登录已失效（403 token not found），请重新执行：node main.js login');
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
          // 页面“最终价格”列 = 预估供应价 estimated_supply_price
          // （bid_price_after_rebate 仅极个别行有值，不可作为数据源）
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
  console.log(`已导出 ${rows.length} 条记录 → ${outPath}`);
}

async function doExport(shopId, outPath) {
  if (!shopId) {
    console.error('请指定店铺 ID：node main.js export -s <店铺ID>');
    process.exit(1);
  }
  const cookieHeader = loadCookieHeader();

  // 1. 获取店铺市场（cbsc_shop_region）
  let region = 'ph';
  try {
    const j = await apiGet(cookieHeader, `https://seller.shopee.cn/api/framework/selleraccount/shop_info/?SPC_CDS_VER=2&cnsc_shop_id=${shopId}`);
    if (j.code === 0 && j.data?.shop_region) region = j.data.shop_region.toLowerCase();
    console.log(`店铺 ${shopId} 所属市场: ${region.toUpperCase()}`);
  } catch (e) {
    console.error('获取店铺信息失败，默认使用 ph:', e.message);
  }

  // 2. 拉取【获胜】数据
  console.log('正在拉取【进行中的竞价 → 获胜】数据...');
  const { rows, total } = await fetchWinningData(cookieHeader, shopId, region);
  console.log(`接口返回模型总数: ${total}，实际解析 ${rows.length} 行`);

  if (rows.length === 0) {
    console.log('没有获取到获胜竞价数据。');
    return;
  }

  // 3. 导出 Excel（文件名带时分秒，避免同日多次运行或文件被 Excel 占用导致冲突）
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  const ts = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  const out = outPath || path.join(__dirname, `竞价获胜_店铺${shopId}_${ts}.xlsx`);
  await writeExcel(shopId, rows, out);
}

// ============ 一键模式：接收 Cookie → 输入店铺ID → 导出 ============
async function runAll() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  console.log('========== Shopee 竞价数据导出工具 ==========');
  console.log('第 1 步：请点击浏览器扩展 [Shopee 竞价导出助手] → [发送登录信息到本地工具]');
  startCookieServer(async () => {
    try {
      // 清掉已缓冲的 stdin 后询问店铺 ID
      const answer = await rl.question('\n第 2 步：请输入店铺 ID（如 557630453）: ');
      const shopId = answer.trim();
      if (!shopId) {
        console.error('店铺 ID 不能为空！');
        process.exit(1);
      }
      await doExport(shopId, null);
      rl.close();
      process.exit(0);
    } catch (e) {
      console.error('\n导出失败:', e.message);
      process.exit(1);
    }
  });
}

// ============ 入口 ============
const args = process.argv.slice(2);
const cmd = args[0] || 'export';
if (cmd === 'login') {
  startCookieServer();
} else if (cmd === 'run' || cmd === '一键导出') {
  runAll();
} else if (cmd === 'export' || cmd === 'download') {
  const shopIdx = args.findIndex(a => a === '-s' || a === '--shop' || a === '--shop-id');
  const shopId = shopIdx >= 0 ? args[shopIdx + 1] : null;
  const outIdx = args.findIndex(a => a === '-o' || a === '--out');
  const outPath = outIdx >= 0 ? args[outIdx + 1] : null;
  doExport(shopId, outPath).catch(e => { console.error('导出失败:', e.message); process.exit(1); });
} else {
  console.log('用法:\n  node main.js login\n  node main.js export -s <店铺ID> [-o 输出文件.xlsx]');
}
