// 退单仓库页 · 表格解析与导出（纯函数，供 App.vue 复用）。
// SheetJS 读写细节统一走 utils/xlsx.js；本文件只负责本页的列语义，列名以「多客退款单」导出表为标准：
//   站点（站点）、店铺（店名末尾带 shop_id）、退款单号（return_sn）、订单编号（order_sn）；
//   店铺ID 列不是必需的——店名形如 `SP-DM-PH-1店-(元仓+官方仓）-zhangdm1.ph-557630453` 时自动取末尾数字；
//   导出时在 Order ID 列后插入三列「退单仓库ID / 退货仓库 / 退货仓库地址」。
import { xlsxReady } from '../utils/xlsx.js';

/** 导出新列的列名（紧跟 Order ID 列，按此顺序插入） */
export const WHS_COL_NAME = '退单仓库ID';
export const WHS_NAME_COL_NAME = '退货仓库';
export const WHS_ADDR_COL_NAME = '退货仓库地址';

/** 归一化 Return ID：去掉所有空白与零宽字符（Excel 单元格常带不可见字符） */
export function normalizeReturnId(raw) {
  if (raw === null || raw === undefined) return '';
  return String(raw).replace(/[\s\u200b-\u200d\ufeff]+/g, '');
}

/**
 * 归一化店铺ID：
 *  - 纯数字（含 Excel 读成 953673451.0 的情况）直接返回；
 *  - 店铺名（如 `SP-DM_PH-1店-(元仓+官方仓）-zhangdm1.ph-557630453`）取末尾连续 6 位以上数字；
 *  - 取不到（如 TikTok 的 `TK本土-PH-5`）返回空串，由调用方按「无店铺ID」跳过。
 */
export function normalizeShopId(raw) {
  if (raw === null || raw === undefined) return '';
  const s = String(raw).replace(/[\s\u200b-\u200d\ufeff]+/g, '');
  const plain = /^\d+\.0+$/.test(s) ? s.replace(/\.0+$/, '') : s;
  if (/^\d+$/.test(plain)) return plain;
  const m = plain.match(/-(\d{6,})$/);
  return m ? m[1] : '';
}

/** 表头单元格归一化：去空白 + 小写，供列名精确匹配 */
function normHeader(v) {
  return String(v === null || v === undefined ? '' : v).replace(/\s+/g, '').toLowerCase();
}

/** Return ID 列名匹配：退款单号 / Return ID / return_sn / 退货ID / 退单编号 等（精确匹配，避免误中「退货物流单号」） */
export function isReturnIdHeader(v) {
  const s = normHeader(v);
  return /^return(id|sn|no)?$/.test(s) || /^退(货|货单|单)?(id|编号|单号|号)?$/.test(s) || /^退款单(号|编号)$/.test(s);
}

/** Order ID 列名匹配：订单编号 / Order ID / order_sn 等（可选列，缺失时导出新列插在退款单号后） */
export function isOrderIdHeader(v) {
  const s = normHeader(v);
  return /^order(id|sn|no)?$/.test(s) || /^订单(id|编号|单号|号)?$/.test(s);
}

/** 严格店铺ID 列名：Shop ID / shop_id / 店铺ID / 店铺编号（优先于「店铺」列） */
function isStrictShopIdHeader(v) {
  const s = normHeader(v);
  return /^shop(id|sn|no|code)$/.test(s) || /^(店铺|商店)(id|编号|号|代码)$/.test(s);
}

/** 店铺列名：店铺 / 店铺名 / 店铺名称（值里带 shop_id 时由 normalizeShopId 提取） */
function isShopNameHeader(v) {
  const s = normHeader(v);
  return /^(店铺|商店)(名称|名)?$/.test(s) || /^shopname$/.test(s);
}

/**
 * 店铺列匹配：优先严格的「店铺ID」列，其次「店铺」列（多客表里店名末尾就是 shop_id）。
 * 两列同时存在时取前者。
 */
export function isShopIdHeader(v) {
  return isStrictShopIdHeader(v) || isShopNameHeader(v);
}

/**
 * 站点列名匹配：站点 / 国家 / region / site 等（可选列）。
 * 用于把「同站点」的退货仓缩到 1 个，避免逐单查退货物流轨迹。
 */
export function isRegionHeader(v) {
  const s = normHeader(v);
  return /^(站点|国家|地区|区域)$/.test(s) || /^(region|site|country|market)$/.test(s);
}

/**
 * 读取表格（ArrayBuffer）并定位各列。
 * 表头取第 1 行；列名以「多客退款单」导出表为标准：
 *   退款单号（Return ID）、店铺（末尾带 shop_id）两列必填，订单编号可缺省（缺省时导出新列插在退款单号后）；
 *   站点可选，缺失时 regionCol 为 -1（后端按店铺 region 兜底）。
 * 店铺列优先取严格的「店铺ID」，没有再取「店铺」列，避免两列并存时取错。
 * @returns {{ aoa: Array<Array>, returnCol: number, orderCol: number, shopCol: number, regionCol: number, fileName: string }}
 */
export function readTable(arrayBuffer, fileName = '') {
  if (!xlsxReady()) throw new Error('表格组件未加载完成，请刷新页面后重试');
  const wb = window.XLSX.read(arrayBuffer, { type: 'array' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  if (!ws) throw new Error('表格中没有工作表');
  const aoa = window.XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', blankrows: true });
  if (!aoa.length || !aoa[0] || !aoa[0].length) throw new Error('表格第 1 行为空，未找到表头');

  const header = aoa[0];
  let returnCol = -1;
  let orderCol = -1;
  let shopCol = -1;
  let regionCol = -1;
  header.forEach((cell, i) => {
    if (returnCol < 0 && isReturnIdHeader(cell)) returnCol = i;
    else if (orderCol < 0 && isOrderIdHeader(cell)) orderCol = i;
    else if (regionCol < 0 && isRegionHeader(cell)) regionCol = i;
  });
  // 店铺列两轮匹配：严格的店铺ID 优先，其次店铺名（店名末尾带 shop_id）
  header.forEach((cell, i) => {
    if (shopCol < 0 && isStrictShopIdHeader(cell)) shopCol = i;
  });
  if (shopCol < 0) {
    header.forEach((cell, i) => {
      if (shopCol < 0 && isShopNameHeader(cell)) shopCol = i;
    });
  }
  const missing = [
    returnCol < 0 ? '退款单号（Return ID）列' : '',
    shopCol < 0 ? '店铺列（店名末尾需带店铺ID）' : '',
  ].filter(Boolean);
  if (missing.length) {
    throw new Error(`表头第 1 行未识别到${missing.join('、')}。第 1 行识别到：${header.map((c) => String(c || '')).join(' | ')}`);
  }
  return { aoa, returnCol, orderCol, shopCol, regionCol, fileName };
}

/**
 * 从 AOA 提取待查询行（表头之后每一行取 Return ID、店铺ID 与可选站点）。
 * 无 Return ID 的行整行跳过；有 Return ID 但无店铺ID 的行也跳过（由调用方提示）。
 * @returns {{ rows: Array<{ rowIndex: number, returnId: string, shopId: string, region: string }>, skipped: number, skippedNoShop: number }}
 *   rowIndex 为 AOA 行下标（表头=0），与导出写回、SSE 事件回传共用同一套行号
 */
export function buildRows(aoa, cols) {
  const rows = [];
  let skipped = 0;
  let skippedNoShop = 0;
  const regionCol = Number.isInteger(cols.regionCol) ? cols.regionCol : -1;
  for (let i = 1; i < aoa.length; i++) {
    const line = aoa[i] || [];
    const rid = normalizeReturnId(line[cols.returnCol]);
    if (!rid) { skipped += 1; continue; }
    const shopId = normalizeShopId(line[cols.shopCol]);
    if (!shopId) { skippedNoShop += 1; continue; }
    const region = regionCol >= 0 ? String(line[regionCol] || '').replace(/\s+/g, '').toUpperCase() : '';
    rows.push({ rowIndex: i, returnId: rid, shopId, region });
  }
  return { rows, skipped, skippedNoShop };
}

/**
 * 生成导出用 AOA：原表每一行在 Order ID 列后插入三列（无订单编号列时插在退款单号后）。
 *  - 表头行插「退单仓库ID / 退货仓库 / 退货仓库地址」；
 *  - 数据行按 rowIndex 取结果：成功填对应字段，失败首列填「失败：原因」；
 *  - 无 Return ID 的行标「跳过：无 Return ID」，无店铺ID 的行标「跳过：无店铺ID」，
 *    有 ID 但无结果（取消/中断）标「未执行」。
 * @param {Array<Array>} aoa readTable 得到的原表
 * @param {{ returnCol: number, orderCol: number, shopCol: number }} cols 列定位
 * @param {Array<{ rowIndex: number, ok: boolean, whsId?: string, whsName?: string, whsAddress?: string, msg?: string }>} results SSE 收集的结果
 */
export function buildExportAoa(aoa, cols, results) {
  const byRow = new Map((results || []).map((r) => [Number(r.rowIndex), r]));
  const insertAt = (Number.isInteger(cols.orderCol) && cols.orderCol >= 0 ? cols.orderCol : cols.returnCol) + 1;
  return aoa.map((row, i) => {
    const r = Array.isArray(row) ? row.slice() : [];
    if (i === 0) {
      r.splice(insertAt, 0, WHS_COL_NAME, WHS_NAME_COL_NAME, WHS_ADDR_COL_NAME);
      return r;
    }
    const res = byRow.get(i);
    let cells;
    if (res) {
      cells = res.ok
        ? [String(res.whsId || ''), String(res.whsName || ''), String(res.whsAddress || '')]
        : [`失败：${res.msg || '未知原因'}`, '', ''];
    } else if (!normalizeReturnId((aoa[i] || [])[cols.returnCol])) cells = ['跳过：无 Return ID', '', ''];
    else if (!normalizeShopId((aoa[i] || [])[cols.shopCol])) cells = ['跳过：无店铺ID', '', ''];
    else cells = ['未执行', '', ''];
    r.splice(insertAt, 0, ...cells);
    return r;
  });
}
