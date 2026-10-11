// 退单仓库页 · 表格解析与导出（纯函数，供单元测试与 App.vue 复用）。
// SheetJS 读写细节统一走 utils/xlsx.js；本文件只负责本页的列语义：
//   表头第 1 行必须能识别出 Return ID 列（查询唯一依据：get_return_detail 只认 return_sn）；
//   Order ID 列与「店铺id」列均可选——Order ID 仅用作导出时新列的插入位置，
//   没有它时新列插在 Return ID 列后；店铺id 列有则该行按表格取值（多店铺混合表，
//   允许不选店铺），没有时要求页面恰好选中 1 个店铺兜底。
//   导出时在 Order ID 列（或 Return ID 列）后插入新列「退单仓库ID」。
import { xlsxReady } from '../utils/xlsx.js';

/** 导出新列的列名（紧跟 Order ID 列） */
export const WHS_COL_NAME = '退单仓库ID';

/** 归一化 Return ID：去掉所有空白与零宽字符（Excel 单元格常带不可见字符） */
export function normalizeReturnId(raw) {
  if (raw === null || raw === undefined) return '';
  return String(raw).replace(/[\s\u200b-\u200d\ufeff]+/g, '');
}

/** 归一化店铺 ID（表格「店铺id」列取值）：同上去空白/零宽；Excel 数字单元格先转字符串 */
export function normalizeShopId(raw) {
  return normalizeReturnId(raw);
}

/** 表头单元格归一化：去空白 + 小写，供列名精确匹配 */
function normHeader(v) {
  return String(v === null || v === undefined ? '' : v).replace(/\s+/g, '').toLowerCase();
}

/** Return ID 列名匹配：Return ID / return_sn / 退货ID / 退单编号 等（精确匹配，避免误中「退货物流单号」；下划线可省） */
export function isReturnIdHeader(v) {
  const s = normHeader(v);
  return /^return_?(id|sn|no)?$/.test(s) || /^退(货|货单|单)?(id|编号|单号|号)?$/.test(s);
}

/** Order ID 列名匹配：Order ID / order_sn / 订单ID / 订单编号 / 原订单号 等（下划线可省） */
export function isOrderIdHeader(v) {
  const s = normHeader(v);
  return /^order_?(id|sn|no)?$/.test(s) || /^(原(始)?)?订单(id|编号|单号|号)?$/.test(s);
}

/** 店铺id 列名匹配：店铺id / shop_id / Shop ID / 店铺编号 等（可选列，缺省 -1） */
export function isShopIdHeader(v) {
  const s = normHeader(v);
  return /^shop_?id$/.test(s) || /^店铺(id|编号|号)?$/.test(s);
}

/**
 * 读取表格（ArrayBuffer）并定位各列。
 * 表头取第 1 行；Return ID 列缺失时抛出中文错误（含识别到的第 1 行内容，便于排查）；
 * Order ID 列与「店铺id」列均可选，缺失时对应下标为 -1（Order ID 仅决定导出新列插入位置）。
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
  if (returnCol < 0) {
    throw new Error(`表头第 1 行未识别到 Return ID 列（查询只认 Return ID，Order ID 无法反查退单号）。第 1 行识别到：${header.map((c) => String(c || '')).join(' | ')}`);
  }
  return { aoa, returnCol, orderCol, shopCol, fileName };
}

/**
 * 从 AOA 提取待查询行（表头之后的每一行取 Return ID 列值）。
 * 每行店铺确定规则（优先级从高到低）：
 *   1. 表格「店铺id」列该行的值（shopCol >= 0 时）——多店铺混合表靠它驱动，允许不选店铺；
 *   2. 页面恰好选中 1 个店铺时用该店兜底（selectedShopIds 长度为 1）；
 *   3. 都取不到 → 该行无法确定店铺，记入 unresolvedRows 跳过（导出时标注原因）。
 * @returns {{ rows: Array<{ rowIndex: number, returnId: string, shopId: string }>, skipped: number,
 *            unresolved: number, unresolvedRows: number[] }}
 *   rowIndex 为 AOA 行下标（表头=0），与导出写回、SSE 事件回传共用同一套行号
 */
export function buildRows(aoa, returnCol, shopCol, selectedShopIds) {
  const rows = [];
  const unresolvedRows = [];
  let skipped = 0;
  const fallback = Array.isArray(selectedShopIds) && selectedShopIds.length === 1
    ? normalizeShopId(selectedShopIds[0])
    : '';
  for (let i = 1; i < aoa.length; i++) {
    const rid = normalizeReturnId((aoa[i] || [])[returnCol]);
    if (!rid) { skipped += 1; continue; }
    let shopId = shopCol >= 0 ? normalizeShopId((aoa[i] || [])[shopCol]) : '';
    if (!shopId) shopId = fallback;
    if (!shopId) { unresolvedRows.push(i); continue; }
    rows.push({ rowIndex: i, returnId: rid, shopId });
  }
  return { rows, skipped, unresolved: unresolvedRows.length, unresolvedRows };
}

/**
 * 生成导出用 AOA：原表每一行插入新列（有 Order ID 列时插在其后，没有时插在 Return ID 列后）。
 *  - 表头行插「退单仓库ID」；
 *  - 数据行按 rowIndex 取结果：成功填 whs_id，失败填「失败：原因」；
 *  - 无 Return ID 的行标「跳过：无 Return ID」，无法确定店铺的行标「跳过：无法确定店铺」，
 *    有 ID 但无结果（取消/中断）标「未执行」。
 * @param {Array<Array>} aoa readTable 得到的原表
 * @param {{ returnCol: number, orderCol: number }} cols 列定位（orderCol 为 -1 表示无 Order ID 列）
 * @param {Array<{ rowIndex: number, ok: boolean, whsId?: string, msg?: string }>} results SSE 收集的结果
 * @param {number[]} [unresolvedRows] buildRows 返回的无法确定店铺的行号
 */
export function buildExportAoa(aoa, cols, results, unresolvedRows) {
  const byRow = new Map((results || []).map((r) => [Number(r.rowIndex), r]));
  const unresolved = new Set((unresolvedRows || []).map(Number));
  const at = (cols.orderCol >= 0 ? cols.orderCol : cols.returnCol) + 1;
  return aoa.map((row, i) => {
    const r = Array.isArray(row) ? row.slice() : [];
    if (i === 0) {
      r.splice(at, 0, WHS_COL_NAME);
      return r;
    }
    const res = byRow.get(i);
    let cell;
    if (res) cell = res.ok ? String(res.whsId || '') : `失败：${res.msg || '未知原因'}`;
    else if (unresolved.has(i)) cell = '跳过：无法确定店铺';
    else if (normalizeReturnId((aoa[i] || [])[cols.returnCol])) cell = '未执行';
    else cell = '跳过：无 Return ID';
    r.splice(at, 0, cell);
    return r;
  });
}
