// 退单仓库页 · 表格解析与导出（纯函数，供单元测试与 App.vue 复用）。
// SheetJS 读写细节统一走 utils/xlsx.js；本文件只负责本页的列语义：
//   表头第 1 行必须能识别出 Return ID 列与 Order ID 列；
//   导出时在 Order ID 列后插入新列「退单仓库ID」。
import { xlsxReady } from '../utils/xlsx.js';

/** 导出新列的列名（紧跟 Order ID 列） */
export const WHS_COL_NAME = '退单仓库ID';

/** 归一化 Return ID：去掉所有空白与零宽字符（Excel 单元格常带不可见字符） */
export function normalizeReturnId(raw) {
  if (raw === null || raw === undefined) return '';
  return String(raw).replace(/[\s\u200b-\u200d\ufeff]+/g, '');
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
 * 读取表格（ArrayBuffer）并定位两列。
 * 表头取第 1 行；两列任一缺失时抛出中文错误（含识别到的第 1 行内容，便于排查）。
 * @returns {{ aoa: Array<Array>, returnCol: number, orderCol: number, fileName: string }}
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
  header.forEach((cell, i) => {
    if (returnCol < 0 && isReturnIdHeader(cell)) returnCol = i;
    else if (orderCol < 0 && isOrderIdHeader(cell)) orderCol = i;
  });
  if (returnCol < 0 || orderCol < 0) {
    const missing = returnCol < 0 && orderCol < 0 ? 'Return ID 列和 Order ID 列'
      : (returnCol < 0 ? 'Return ID 列' : 'Order ID 列');
    throw new Error(`表头第 1 行未识别到${missing}。第 1 行识别到：${header.map((c) => String(c || '')).join(' | ')}`);
  }
  return { aoa, returnCol, orderCol, fileName };
}

/**
 * 从 AOA 提取待查询行（表头之后的每一行取 Return ID 列值）。
 * @returns {{ rows: Array<{ rowIndex: number, returnId: string }>, skipped: number }}
 *   rowIndex 为 AOA 行下标（表头=0），与导出写回、SSE 事件回传共用同一套行号
 */
export function buildRows(aoa, returnCol) {
  const rows = [];
  let skipped = 0;
  for (let i = 1; i < aoa.length; i++) {
    const rid = normalizeReturnId((aoa[i] || [])[returnCol]);
    if (!rid) { skipped += 1; continue; }
    rows.push({ rowIndex: i, returnId: rid });
  }
  return { rows, skipped };
}

/**
 * 生成导出用 AOA：原表每一行在 Order ID 列后插入新列。
 *  - 表头行插「退单仓库ID」；
 *  - 数据行按 rowIndex 取结果：成功填 whs_id，失败填「失败：原因」；
 *  - 无 Return ID 的行标「跳过：无 Return ID」，有 ID 但无结果（取消/中断）标「未执行」。
 * @param {Array<Array>} aoa readTable 得到的原表
 * @param {{ returnCol: number, orderCol: number }} cols 列定位
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
    else if (normalizeReturnId((aoa[i] || [])[cols.returnCol])) cell = '未执行';
    else cell = '跳过：无 Return ID';
    r.splice(cols.orderCol + 1, 0, cell);
    return r;
  });
}
