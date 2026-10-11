'use strict';
// 退单仓库查询纯函数：Return ID / 店铺 ID 归一化、whs_id 提取、执行分块。
// 与 job.js（编排）分离，供单元测试直接复用，不打真实网关。
//
// 链路依据（2026-10 生产店铺实测，退单号已省略）：
//   v2.returns.get_return_detail 的 response.return_address.whs_id 即退货仓库 ID（如 PHBUL4）；
//   return_pickup_address（买家取货地址）全量打码不可用；get_return_list 响应不含 whs_id。

/** 归一化 Return ID：去掉首尾及内部空白（Excel 单元格常带不可见字符），非字符串按空处理 */
function normalizeReturnId(raw) {
  if (raw === null || raw === undefined) return '';
  return String(raw).replace(/[\s\u200b-\u200d\ufeff]+/g, '');
}

/**
 * 归一化店铺 ID（表格「店铺id」列取值）：同样去空白/零宽字符。
 * Excel 数字单元格会读成 number，统一转字符串；店铺 ID 仅用于选凭证，不做数值运算。
 */
function normalizeShopId(raw) {
  return normalizeReturnId(raw);
}

/**
 * 从 get_return_detail 响应提取退货仓库 ID。
 * 路径：response.return_address.whs_id；缺失 / 空串一律返回 ''（由调用方记为失败并说明原因）。
 */
function extractWhsId(resp) {
  const ra = resp && resp.response && resp.response.return_address;
  const id = ra && ra.whs_id;
  return id === undefined || id === null ? '' : String(id).trim();
}

/** 把行列表按 size 切块（SSE 执行单元；块内逐行串行，块间走 checkpoint 保证暂停/取消及时） */
function splitChunks(rows, size) {
  if (!Array.isArray(rows) || rows.length === 0) return [];
  const n = Math.max(1, Math.floor(Number(size) || 1));
  const out = [];
  for (let i = 0; i < rows.length; i += n) out.push(rows.slice(i, i + n));
  return out;
}

module.exports = { normalizeReturnId, normalizeShopId, extractWhsId, splitChunks };
