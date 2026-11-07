'use strict';
// 执行「获取退单仓库」（SSE 流式事件）：按店铺取退货仓清单 + 按站点筛选，必要时用逆向物流轨迹消歧。
// 批量骨架（SSE 建立 / 断开即取消 / 逐块 checkpoint / CancelledError 归并 / 收尾）统一走 lib/jobs.runShopBatch。
//
// 调用口径（2026-11 生产店铺实测，详见 docs/开放平台链路.md §5）：
//   每店 1 次  GET /api/v2/shop/get_warehouse_detail?warehouse_type=2 → 退货仓清单（含完整地址）
//   站点来源   表格「站点」列；缺失时回退 GET /api/v2/shop/get_shop_info 的 region（同样每店 1 次并缓存）
//   逐单      同站点只剩 1 个退货仓 → 直接用（不调接口）；多个仓 → GET /api/v2/returns/get_reverse_tracking_info
//              用轨迹节点地名匹配仓；仍不确定时兜底 GET /api/v2/returns/get_return_detail 的 whs_id
//
// 多店铺口径：店铺不在这里选，按表格每行的「店铺」列（店名末尾的店铺ID，或独立的店铺ID 列）逐行切换凭证（callOpenApi 支持按 shopId 取 token）。
// 表格解析与导出在前端完成（SheetJS，与 video 页一致）；本模块只接收解析后的行：
//   { rows: [{ rowIndex, returnId, shopId, region }] }，rowIndex 为 AOA 行号（表头=0），
//   用于前端把结果写回原表格的对应行。
const { sendJson } = require('../lib/http-utils');
const jobs = require('../lib/jobs');
const { callOpenApi } = require('../openapi/client');
const store = require('../openapi/store');
const {
  normalizeReturnId, normalizeRegion, extractWhsId, pickWarehouseList,
  pickReturnWarehouses, toWarehouseResult, matchWarehouseByTracking, splitChunks,
} = require('./parse');

/** 单次任务行数上限（防误传超大表把网关打爆） */
const MAX_ROWS = 2000;
/** 每个 SSE 执行单元的行数（块内串行；块间 checkpoint，暂停/取消最多延迟一块） */
const CHUNK_SIZE = 20;

/**
 * 归一化 shopId：去空白与零宽字符（Excel 单元格常带不可见字符）；
 * 纯数字（含 953673451.0）直接返回；传入店铺名时取末尾 ≥6 位数字（多客表店名末尾就是 shop_id）。
 */
function normalizeShopId(raw) {
  const s = normalizeReturnId(raw);
  const plain = /^\d+\.0+$/.test(s) ? s.replace(/\.0+$/, '') : s;
  if (/^\d+$/.test(plain)) return plain;
  const m = plain.match(/-(\d{6,})$/);
  return m ? m[1] : '';
}

/** 归一化入参行：过滤空 Return ID，rowIndex 缺省回退为下标；region 可缺省（后端按店铺查） */
function normalizeRows(rows) {
  const out = [];
  (Array.isArray(rows) ? rows : []).forEach((r, i) => {
    const returnId = normalizeReturnId(r && r.returnId);
    if (!returnId) return;
    const rowIndex = Number.isFinite(Number(r && r.rowIndex)) ? Number(r.rowIndex) : i;
    out.push({
      rowIndex,
      returnId,
      shopId: normalizeShopId(r && r.shopId),
      region: normalizeRegion(r && r.region),
    });
  });
  return out;
}

/**
 * 查询店铺退货仓上下文：退货仓清单 + 站点 + 同站点候选。
 * 站点优先取表格「站点」列，缺省时调 get_shop_info 取店铺 region。
 * @returns {{ region: string, warehouses: Array, candidates: Array }}
 */
async function loadShopWarehouses(shopId, regionHint) {
  const detail = await callOpenApi('/api/v2/shop/get_warehouse_detail', { warehouse_type: 2 }, { shopId, method: 'GET' });
  const warehouses = pickWarehouseList(detail);
  let region = normalizeRegion(regionHint);
  if (!region) {
    const info = await callOpenApi('/api/v2/shop/get_shop_info', {}, { shopId, method: 'GET' });
    region = normalizeRegion(info && info.region);
  }
  let candidates = pickReturnWarehouses(warehouses, region);
  // 站点对不上且全店只有 1 个退货仓时，仍按该仓处理（否则整店都查不到地址）
  if (candidates.length === 0 && warehouses.length === 1) candidates = warehouses;
  return { region, warehouses, candidates };
}

/** 无法解析仓库时的中文原因（区分「没配仓」「多个仓无法判断」「该单无需退货」） */
function failMessage(shopCtx) {
  if (shopCtx.candidates.length > 1) {
    return `该店铺在 ${shopCtx.region || '-'} 站点有 ${shopCtx.candidates.length} 个退货仓，退货物流轨迹无法判断实际仓库，请人工核对`;
  }
  if (shopCtx.warehouses.length === 0) return '该店铺未配置退货仓（get_warehouse_detail 返回空）';
  return '接口未返回退货仓库（该退单可能无需退货物流）';
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
      msg: `有 ${noShop.length} 行店铺列取不到店铺ID（${sample}${noShop.length > 5 ? ' 等' : ''}），请检查「店铺」列（店名末尾需带店铺ID）后重试`,
    });
    return;
  }

  const shopIds = Array.from(new Set(rows.map((r) => r.shopId)));
  // 未授权 / 已失效的店铺不整批拦截，只把这些店铺的行标失败，其余店铺照常执行
  const app = store.getApp();
  const badShops = new Set(shopIds.filter((id) => {
    const s = app ? store.getShop(app.env, id) : null;
    return !s || s.invalid;
  }));

  // 店铺级上下文缓存：同一店铺只查一次退货仓清单（站点提示取该店第一条非空值）
  const shopCtxCache = new Map();
  const regionHintOf = new Map();
  for (const r of rows) {
    if (!regionHintOf.get(r.shopId)) regionHintOf.set(r.shopId, r.region);
  }
  const getShopCtx = (shopId) => {
    if (!shopCtxCache.has(shopId)) {
      const p = loadShopWarehouses(shopId, regionHintOf.get(shopId))
        .catch((e) => ({ error: e.message, region: normalizeRegion(regionHintOf.get(shopId)), warehouses: [], candidates: [] }));
      shopCtxCache.set(shopId, p);
    }
    return shopCtxCache.get(shopId);
  };

  const results = [];
  jobs.runShopBatch({
    res,
    units: splitChunks(rows, CHUNK_SIZE),
    startPayload: { total: rows.length, shopCount: shopIds.length, skippedShops: Array.from(badShops) },
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
        if (badShops.has(row.shopId)) {
          recordRow(row, false, { msg: '店铺未授权或授权已失效，请先到「开放平台」页完成授权' });
          continue;
        }
        try {
          const shopCtx = await getShopCtx(row.shopId);
          if (shopCtx.error) throw new Error(shopCtx.error);
          // 每店只播报一次退货仓，便于前端核对站点与候选数量
          if (!shopCtx.reported) {
            shopCtx.reported = true;
            ctx.emit({
              type: 'shop-warehouse',
              shopId: row.shopId,
              region: shopCtx.region,
              candidates: shopCtx.candidates.map(toWarehouseResult),
            });
          }

          let hit = null;
          let source = '';
          if (shopCtx.candidates.length === 1) {
            hit = toWarehouseResult(shopCtx.candidates[0]);
            source = 'shop';
          } else if (shopCtx.candidates.length > 1) {
            // 轨迹查不到（该单无逆向物流 / 接口报错）不算致命，继续走 whs_id 兜底
            try {
              const tracking = await callOpenApi(
                '/api/v2/returns/get_reverse_tracking_info',
                { return_sn: row.returnId },
                { shopId: row.shopId, method: 'GET' },
              );
              const w = matchWarehouseByTracking(tracking, shopCtx.candidates);
              if (w) { hit = toWarehouseResult(w); source = 'tracking'; }
            } catch { /* 交由下方兜底与失败文案处理 */ }
          }

          if (hit) {
            recordRow(row, true, Object.assign({}, hit, { source }));
          } else {
            // 兜底：detail 的 whs_id（可能是 PHBUL4 这类字符串 ID，无地址）
            const detail = await callOpenApi(
              '/api/v2/returns/get_return_detail',
              { return_sn: row.returnId },
              { shopId: row.shopId, method: 'GET' },
            );
            const whsId = extractWhsId(detail);
            if (whsId) {
              recordRow(row, true, { whsId, whsName: '', whsAddress: '', region: shopCtx.region, source: 'detail' });
            } else {
              recordRow(row, false, { msg: failMessage(shopCtx) });
            }
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
