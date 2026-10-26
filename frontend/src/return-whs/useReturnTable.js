// 退单仓库页 · 表格解析与导出（纯函数，供 App.vue 复用）。
// SheetJS 读写细节统一走 utils/xlsx.js；本文件只负责本页的列语义：
//   表头第 1 行必须能识别出 Return ID 列、Order ID 列与店铺ID 列（多店铺按行取店铺）；
//   导出时在 Order ID 列后插入新列「退单仓库ID」。
import { xlsxReady } from '../utils/xlsx.js';

/** 导出新列的列名（紧跟 Order ID 列） */
export const WHS_COL_NAME = '退单仓库ID';

/** 归一化 Return ID：去掉所有空白与零宽字符（Excel 单元格常带不可见字符） */
export function normalizeReturnId(raw) {
  if (raw === null || raw === undefined) return '';
  return String(raw).replace(/[\s\u200b-\u200d\ufeff]+/g, '');
}

/** 归一化店铺ID：同样去空白/零宽；数字单元格被读成 953673451.0 时去掉尾部 .0 */
export function normalizeShopId(raw) {
  if (raw === null || raw === undefined) return '';
  const s = String(raw).replace(/[\s\u200b-\u200d\ufeff]+/g, '');
  return /^\d+\.0+$/.test(s) ? s.replace(/\.0+$/, '') : s;
}

/** 表头单元格归一化：去空白 + 小写，供列名精确匹配 */
function normHeader(v) {
  return String(v === null || v === undefined ? '' : v).replace(/\s+/g, '').toLowerCase();
}

/** Return ID 列名匹配：Return ID / return_sn / 退货ID / 退单编号 等（精确匹配，避免误中「退货物流单号」） */
export function isReturnIdHeader(v) {
  const s = normHeader(v);
  return /^return(id|sn|no)?$/.test(s) || /^退(货|货单|单)?(id|编号|单号|号)?$/.test(s);
}

/** Order ID 列名匹配：Order ID / order_sn / 订单ID / 订单编号 等 */
export function isOrderIdHeader(v) {
  const s = normHeader(v);
  return /^order(id|sn|no)?$/.test(s) || /^订单(id|编号|单号|号)?$/.test(s);
}

/**
 * 店铺ID 列名匹配：Shop ID / shop_id / 店铺ID / 店铺编号 等。
 * 必须有 id 语义，「店铺名」「店铺」不算——避免把店名列当成店铺ID。
 */
export function isShopIdHeader(v) {
  const s = normHeader(v);
  return /^shop(id|sn|no|code)$/.test(s) || /^(店铺|商店)(id|编号|号|代码)$/.test(s);
}

/**
 * 读取表格（ArrayBuffer）并定位三列。
 * 表头取第 1 行；任一列缺失时抛出中文错误（含识别到的第 1 行内容，便于排查）。
 * @returns {{ aoa: Array<Array>, returnCol: number, orderCol: number, shopCol: number, fileName: string }}
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
  header.forEach((cell, i) => {
    if (returnCol < 0 && isReturnIdHeader(cell)) returnCol = i;
    else if (orderCol < 0 && isOrderIdHeader(cell)) orderCol = i;
    else if (shopCol < 0 && isShopIdHeader(cell)) shopCol = i;
  });
  const missing = [
    returnCol < 0 ? 'Return ID 列' : '',
    orderCol < 0 ? 'Order ID 列' : '',
    shopCol < 0 ? '店铺ID 列' : '',
  ].filter(Boolean);
  if (missing.length) {
    throw new Error(`表头第 1 行未识别到${missing.join('、')}。第 1 行识别到：${header.map((c) => String(c || '')).join(' | ')}`);
  }
  return { aoa, returnCol, orderCol, shopCol, fileName };
}

/**
 * 从 AOA 提取待查询行（表头之后每一行取 Return ID 列与店铺ID 列）。
 * 无 Return ID 的行整行跳过；有 Return ID 但无店铺ID 的行也跳过（由调用方提示）。
 * @returns {{ rows: Array<{ rowIndex: number, returnId: string, shopId: string }>, skipped: number, skippedNoShop: number }}
 *   rowIndex 为 AOA 行下标（表头=0），与导出写回、SSE 事件回传共用同一套行号
 */
export function buildRows(aoa, cols) {
  const rows = [];
  let skipped = 0;
  let skippedNoShop = 0;
  for (let i = 1; i < aoa.length; i++) {
    const line = aoa[i] || [];
    const rid = normalizeReturnId(line[cols.returnCol]);
    if (!rid) { skipped += 1; continue; }
    const shopId = normalizeShopId(line[cols.shopCol]);
    if (!shopId) { skippedNoShop += 1; continue; }
    rows.push({ rowIndex: i, returnId: rid, shopId });
  }
  return { rows, skipped, skippedNoShop };
}

/**
 * 生成导出用 AOA：原表每一行在 Order ID 列后插入新列。
 *  - 表头行插「退单仓库ID」；
 *  - 数据行按 rowIndex 取结果：成功填 whs_id，失败填「失败：原因」；
 *  - 无 Return ID 的行标「跳过：无 Return ID」，无店铺ID 的行标「跳过：无店铺ID」，
 *    有 ID 但无结果（取消/中断）标「未执行」。
 * @param {Array<Array>} aoa readTable 得到的原表
 * @param {{ returnCol: number, orderCol: number, shopCol: number }} cols 列定位
 * @param {Array<{ rowIndex: number, ok: boolean, whsId?: string, msg?: string }>} results SSE 收集的结果
 */
export function buildExportAoa(aoa, cols, results) {
  const byRow = new Map((results || []).map((r) => [Number(r.rowIndex), r]));
  return aoa.map((row, i) => {
    const r = Array.isArray(row) ? row.slice() : [];
    if (i === 0) {
      r.splice(cols.orderCol + 1, 0, WHS_COL_NAME);
      return r;
    }
    const res = byRow.get(i);
    let cell;
    if (res) cell = res.ok ? String(res.whsId || '') : `失败：${res.msg || '未知原因'}`;
    else if (!normalizeReturnId((aoa[i] || [])[cols.returnCol])) cell = '跳过：无 Return ID';
    else if (!normalizeShopId((aoa[i] || [])[cols.shopCol])) cell = '跳过：无店铺ID';
    else cell = '未执行';
    r.splice(cols.orderCol + 1, 0, cell);
    return r;
  });
}
