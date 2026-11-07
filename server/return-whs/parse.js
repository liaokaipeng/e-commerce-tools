'use strict';
// 退单仓库查询纯函数：Return ID 归一化、仓库候选筛选、轨迹匹配、执行分块。
// 与 job.js（编排）分离，供单元测试直接复用，不打真实网关。
//
// 链路依据（2026-11 生产店铺实测，退单号已省略）：
//   1. v2.returns.get_return_detail 的 return_address.whs_id 在本土 / 跨境店常为空串，
//      return_pickup_address 全量打码，拿不到地址——不能作为地址来源，只保留为兜底；
//   2. v2.shop.get_warehouse_detail(warehouse_type=2) 返回店铺全部退货仓（含完整地址）；
//   3. 同行站点过滤后只剩 1 个退货仓时，该仓即实际收货仓，无需逐单查询；
//   4. 同站点有多个退货仓时，用 v2.returns.get_reverse_tracking_info 的轨迹节点
//      （如「Parcel has arrived at sorting facility : OP Makiliing Calamba Hub」）
//      与仓的 town / district / city / state 匹配。

/** 归一化 Return ID：去掉首尾及内部空白（Excel 单元格常带不可见字符），非字符串按空处理 */
function normalizeReturnId(raw) {
  if (raw === null || raw === undefined) return '';
  return String(raw).replace(/[\s\u200b-\u200d\ufeff]+/g, '');
}

/** 归一化站点代码：去空白并转大写（表格站点列常见 PH / ph / Ph） */
function normalizeRegion(raw) {
  if (raw === null || raw === undefined) return '';
  return String(raw).replace(/[\s\u200b-\u200d\ufeff]+/g, '').toUpperCase();
}

/**
 * 从 get_return_detail 响应提取退货仓库 ID（兜底口径）。
 * 路径：response.return_address.whs_id；缺失 / 空串一律返回 ''。
 */
function extractWhsId(resp) {
  const ra = resp && resp.response && resp.response.return_address;
  const id = ra && ra.whs_id;
  return id === undefined || id === null ? '' : String(id).trim();
}

/**
 * 从 get_warehouse_detail 响应取出仓库数组。
 * 该接口把数组放在 response（而非多数接口的 response 对象）里。
 */
function pickWarehouseList(resp) {
  const list = resp && resp.response;
  return Array.isArray(list) ? list.filter((w) => w && typeof w === 'object') : [];
}

/**
 * 按站点筛选退货仓候选：region 为空时返回全部（由调用方决定是否可用）。
 * 接口按 warehouse_type=2 调用时已只返回退货仓，这里再按类型兜底过滤一次。
 */
function pickReturnWarehouses(list, region) {
  const arr = (Array.isArray(list) ? list : []).filter((w) => {
    if (!w || typeof w !== 'object') return false;
    return w.warehouse_type === undefined || w.warehouse_type === null || Number(w.warehouse_type) === 2;
  });
  const r = normalizeRegion(region);
  if (!r) return arr;
  return arr.filter((w) => normalizeRegion(w.region) === r);
}

/** 仓库对象 → 导出用结果（字段名与 SSE 事件 / 前端表格保持一致） */
function toWarehouseResult(w) {
  const id = w && w.warehouse_id;
  return {
    whsId: id === undefined || id === null ? '' : String(id),
    whsName: String((w && w.warehouse_name) || '').trim(),
    whsAddress: String((w && w.address) || '').trim(),
    region: normalizeRegion(w && w.region),
  };
}

/** 匹配用归一化：小写 + 去掉标点与空白，只保留字母数字与汉字 */
function normalizeForMatch(v) {
  return String(v === null || v === undefined ? '' : v).toLowerCase().replace(/[^0-9a-z\u4e00-\u9fa5]+/g, '');
}

/** 地址词是否足够具体：汉字 ≥2 字，拉丁字母 / 数字 ≥5 字符（过滤 city / town 这类通用词） */
function isSpecificWord(word) {
  if (!word) return false;
  return /[\u4e00-\u9fa5]/.test(word) ? word.length >= 2 : word.length >= 5;
}

/** 仓库的地名候选词（town / district / city / state 按空白与标点拆词后过滤通用词） */
function locationWords(w) {
  const parts = [w && w.town, w && w.district, w && w.city, w && w.state];
  const out = [];
  for (const p of parts) {
    for (const word of String(p || '').split(/[\s,，、/]+/)) {
      const n = normalizeForMatch(word);
      if (isSpecificWord(n)) out.push(n);
    }
  }
  return out;
}

/**
 * 用逆向物流轨迹匹配退货仓：按轨迹时间倒序逐条比对，命中最具体的一条即返回该仓。
 * 轨迹文案如「Parcel has arrived at sorting facility : OP Makiliing Calamba Hub」，
 * 与仓的 Calamba（district）命中；未命中返回 null（由调用方兜底或记为失败）。
 * @param {object} trackingResp get_reverse_tracking_info 原始响应
 * @param {Array} warehouses 候选仓（同站点）
 * @returns {object|null} 命中的仓库对象
 */
function matchWarehouseByTracking(trackingResp, warehouses) {
  const info = trackingResp && trackingResp.response && trackingResp.response.tracking_info;
  if (!Array.isArray(info) || !Array.isArray(warehouses) || warehouses.length === 0) return null;
  const ordered = info.slice().sort((a, b) => Number((b && b.update_time) || 0) - Number((a && a.update_time) || 0));
  for (const item of ordered) {
    const text = normalizeForMatch(item && item.tracking_description);
    if (!text) continue;
    let best = null;
    let bestScore = 0;
    for (const w of warehouses) {
      const score = locationWords(w).filter((word) => text.includes(word)).length;
      if (score > bestScore) { best = w; bestScore = score; }
    }
    if (best) return best;
  }
  return null;
}

/** 把行列表按 size 切块（SSE 执行单元；块内逐行串行，块间走 checkpoint 保证暂停/取消及时） */
function splitChunks(rows, size) {
  if (!Array.isArray(rows) || rows.length === 0) return [];
  const n = Math.max(1, Math.floor(Number(size) || 1));
  const out = [];
  for (let i = 0; i < rows.length; i += n) out.push(rows.slice(i, i + n));
  return out;
}

module.exports = {
  normalizeReturnId,
  normalizeRegion,
  extractWhsId,
  pickWarehouseList,
  pickReturnWarehouses,
  toWarehouseResult,
  matchWarehouseByTracking,
  splitChunks,
};
