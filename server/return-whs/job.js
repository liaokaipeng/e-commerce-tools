'use strict';
// 执行「获取退单仓库」（SSE 流式事件）：逐行用 Return ID 调开放平台 get_return_detail，
// 取 response.return_address.whs_id，支持暂停/继续/取消。
// 批量骨架（SSE 建立 / 断开即取消 / 逐块 checkpoint / CancelledError 归并 / 收尾）统一走 lib/jobs.runShopBatch。
//
// 表格解析与导出在前端完成（SheetJS，与 video 页一致）；本模块只接收解析后的行：
//   { shopId, rows: [{ rowIndex, returnId }] }，rowIndex 为 AOA 行号（表头=0），
//   用于前端把结果写回原表格的对应行。
const { sendJson } = require('../lib/http-utils');
const jobs = require('../lib/jobs');
const { callOpenApi } = require('../openapi/client');
const { normalizeReturnId, extractWhsId, splitChunks } = require('./parse');

/** 单次任务行数上限（防误传超大表把网关打爆） */
const MAX_ROWS = 2000;
/** 每个 SSE 执行单元的行数（块内串行；块间 checkpoint，暂停/取消最多延迟一块） */
const CHUNK_SIZE = 20;

/** 归一化入参行：过滤空 Return ID，rowIndex 缺省回退为下标 */
function normalizeRows(rows) {
  const out = [];
  (Array.isArray(rows) ? rows : []).forEach((r, i) => {
    const returnId = normalizeReturnId(r && r.returnId);
    if (!returnId) return;
    const rowIndex = Number.isFinite(Number(r && r.rowIndex)) ? Number(r.rowIndex) : i;
    out.push({ rowIndex, returnId });
  });
  return out;
}

function handleRun(body, res) {
  const shopId = String((body && body.shopId) || '').trim();
  if (!shopId) {
    sendJson(res, 400, { ok: false, msg: '请先选择店铺' });
    return;
  }
  const rows = normalizeRows(body && body.rows);
  if (rows.length === 0) {
    sendJson(res, 400, { ok: false, msg: '表格中没有有效的 Return ID，请检查表格是否包含 Return ID 列且有数据' });
    return;
  }
  if (rows.length > MAX_ROWS) {
    sendJson(res, 400, { ok: false, msg: `单次最多处理 ${MAX_ROWS} 行，当前 ${rows.length} 行，请分批` });
    return;
  }

  const results = [];
  jobs.runShopBatch({
    res,
    units: splitChunks(rows, CHUNK_SIZE),
    startPayload: { shopId, total: rows.length },
    onUnit: async (chunk, ctx) => {
      for (const row of chunk) {
        await ctx.checkpoint();
        ctx.emit({ type: 'row-start', rowIndex: row.rowIndex, returnId: row.returnId });
        try {
          const j = await callOpenApi(
            '/api/v2/returns/get_return_detail',
            { return_sn: row.returnId },
            { shopId, method: 'GET' },
          );
          const whsId = extractWhsId(j);
          if (whsId) {
            results.push({ rowIndex: row.rowIndex, returnId: row.returnId, ok: true, whsId });
            ctx.emit({ type: 'row-done', rowIndex: row.rowIndex, returnId: row.returnId, ok: true, whsId });
          } else {
            // 凭证正常但响应无 return_address：多为该退单不需要退货物流（仅退款），属正常业务态
            const msg = '接口未返回退货仓库（该退单可能无需退货物流）';
            results.push({ rowIndex: row.rowIndex, returnId: row.returnId, ok: false, msg });
            ctx.emit({ type: 'row-done', rowIndex: row.rowIndex, returnId: row.returnId, ok: false, msg });
          }
        } catch (e) {
          results.push({ rowIndex: row.rowIndex, returnId: row.returnId, ok: false, msg: e.message });
          ctx.emit({ type: 'row-done', rowIndex: row.rowIndex, returnId: row.returnId, ok: false, msg: e.message });
        }
      }
    },
    finalEvent: ({ cancelledByUser }) => ({
      type: cancelledByUser ? 'cancelled' : 'summary',
      // success/failed 按行计；cancelled 字段沿用骨架语义 = 已处理行数，total = 总行数
      success: results.filter((r) => r.ok).length,
      failed: results.filter((r) => !r.ok).length,
      cancelled: results.length,
      total: rows.length,
    }),
    fatalPrefix: '获取退单仓库失败：',
  });
}

module.exports = { handleRun, normalizeRows, MAX_ROWS, CHUNK_SIZE };
