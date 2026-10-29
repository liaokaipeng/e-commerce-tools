'use strict';
// 执行「获取退单仓库」（SSE 流式事件）：逐行用 Return ID + 店铺ID 调开放平台 get_return_detail，
// 取 response.return_address.whs_id，支持暂停/继续/取消。
// 批量骨架（SSE 建立 / 断开即取消 / 逐块 checkpoint / CancelledError 归并 / 收尾）统一走 lib/jobs.runShopBatch。
//
// 多店铺口径：店铺不在这里选，按表格每行的「店铺ID」列逐行切换凭证（callOpenApi 支持按 shopId 取 token）。
// 表格解析与导出在前端完成（SheetJS，与 video 页一致）；本模块只接收解析后的行：
//   { rows: [{ rowIndex, returnId, shopId }] }，rowIndex 为 AOA 行号（表头=0），
//   用于前端把结果写回原表格的对应行。
const { sendJson } = require('../lib/http-utils');
const jobs = require('../lib/jobs');
const { callOpenApi } = require('../openapi/client');
const store = require('../openapi/store');
const { normalizeReturnId, extractWhsId, splitChunks } = require('./parse');

/** 单次任务行数上限（防误传超大表把网关打爆） */
const MAX_ROWS = 2000;
/** 每个 SSE 执行单元的行数（块内串行；块间 checkpoint，暂停/取消最多延迟一块） */
const CHUNK_SIZE = 20;

/** 归一化 shopId：复用 normalizeReturnId 去空白与零宽字符（Excel 单元格常带不可见字符），数字按整串处理 */
function normalizeShopId(raw) {
  const s = normalizeReturnId(raw);
  return /^\d+\.0+$/.test(s) ? s.replace(/\.0+$/, '') : s;
}

/** 归一化入参行：过滤空 Return ID，rowIndex 缺省回退为下标 */
function normalizeRows(rows) {
  const out = [];
  (Array.isArray(rows) ? rows : []).forEach((r, i) => {
    const returnId = normalizeReturnId(r && r.returnId);
    if (!returnId) return;
    const rowIndex = Number.isFinite(Number(r && r.rowIndex)) ? Number(r.rowIndex) : i;
    out.push({ rowIndex, returnId, shopId: normalizeShopId(r && r.shopId) });
  });
  return out;
}

function handleRun(body, res) {
  const rows = normalizeRows(body && body.rows);
  if (rows.length === 0) {
    sendJson(res, 400, { ok: false, msg: '表格中没有有效的 Return ID，请检查表格是否包含 Return ID 列且有数据' });
    return;
  }
  if (rows.length > MAX_ROWS) {
    sendJson(res, 400, { ok: false, msg: `单次最多处理 ${MAX_ROWS} 行，当前 ${rows.length} 行，请分批` });
    return;
  }
  const noShop = rows.filter((r) => !r.shopId);
  if (noShop.length) {
    const sample = noShop.slice(0, 5).map((r) => `第 ${r.rowIndex + 1} 行`).join('、');
    sendJson(res, 400, {
      ok: false,
      msg: `有 ${noShop.length} 行缺少店铺ID（${sample}${noShop.length > 5 ? ' 等' : ''}），请补全表格「店铺ID」列后重试`,
    });
    return;
  }

  const shopIds = Array.from(new Set(rows.map((r) => r.shopId)));
  // 店铺必须已授权且未失效：先整体拒绝，避免整批逐行报「店铺尚未授权」
  const app = store.getApp();
  const bad = shopIds.filter((id) => {
    const s = app ? store.getShop(app.env, id) : null;
    return !s || s.invalid;
  });
  if (bad.length) {
    sendJson(res, 400, {
      ok: false,
      msg: `表格中有未授权或已失效的店铺ID：${bad.join('、')}，请先到「开放平台」页完成授权`,
    });
    return;
  }
  const results = [];
  jobs.runShopBatch({
    res,
    units: splitChunks(rows, CHUNK_SIZE),
    startPayload: { total: rows.length, shopCount: shopIds.length },
    onUnit: async (chunk, ctx) => {
      // 单行结果：内存归并与 SSE 事件共用同一份 row-done 载荷，字段不会两处漂移
      const recordRow = (row, ok, extra) => {
        const payload = Object.assign({ rowIndex: row.rowIndex, returnId: row.returnId, shopId: row.shopId, ok }, extra);
        results.push(payload);
        ctx.emit(Object.assign({ type: 'row-done' }, payload));
      };
      for (const row of chunk) {
        await ctx.checkpoint();
        ctx.emit({ type: 'row-start', rowIndex: row.rowIndex, returnId: row.returnId, shopId: row.shopId });
        try {
          const j = await callOpenApi(
            '/api/v2/returns/get_return_detail',
            { return_sn: row.returnId },
            { shopId: row.shopId, method: 'GET' },
          );
          const whsId = extractWhsId(j);
          if (whsId) {
            recordRow(row, true, { whsId });
          } else {
            // 凭证正常但响应无 return_address：多为该退单不需要退货物流（仅退款），属正常业务态
            recordRow(row, false, { msg: '接口未返回退货仓库（该退单可能无需退货物流）' });
          }
        } catch (e) {
          recordRow(row, false, { msg: e.message });
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
