'use strict';
// 批量刷新计划（纯函数）：把同环境全部店铺按 refresh_token 归组，决定哪些组可刷、哪些只能跳过。
// 逐店刷新会作废旧 refresh_token、把同组店铺拖成「需重新授权」（官方 FAQ138 Q8），故必须按组去重。
const { planRefresh } = require('../client/plan');

/**
 * 批量刷新计划（纯函数，单测覆盖）：
 * - 按 refreshToken 归组：同组即共享 token 对，**只能刷一次**；
 * - 组内优先用「未失效」店铺当代表（失效店铺自身刷不了，但整组续期成功后会被一并恢复）；
 * - 整组都失效 / 缺 refresh_token / 共享但无 merchant_id 无法整组续期 → 跳过并给出原因。
 * @param {Array<{shopId, refreshToken, merchantId, invalid}>} shops 同环境全部店铺凭证
 * @param {(shop: object, all: Array) => {mode: string}} [planOf] 分组决策函数（默认 planRefresh，便于单测注入）
 * @returns {{groups: Array<{repShopId, shopIds, size, mode}>, skipped: Array<{shopIds, size, reason}>}}
 */
function planRefreshGroups(shops, planOf = planRefresh) {
  const list = Array.isArray(shops) ? shops.slice() : [];
  const byId = (a, b) => String(a).localeCompare(String(b), undefined, { numeric: true });
  const byToken = new Map();
  for (const s of list) {
    if (!s || s.shopId === undefined || s.shopId === null) continue;
    const key = String(s.refreshToken || '');
    if (!byToken.has(key)) byToken.set(key, []);
    byToken.get(key).push(s);
  }

  const groups = [];
  const skipped = [];
  for (const [token, group] of byToken) {
    const shopIds = group.map((s) => String(s.shopId)).sort(byId);
    if (!token) {
      skipped.push({ shopIds, size: shopIds.length, reason: '缺少 refresh_token，需重新授权' });
      continue;
    }
    const active = group.filter((s) => !s.invalid);
    if (!active.length) {
      skipped.push({ shopIds, size: shopIds.length, reason: '授权已失效，需重新授权' });
      continue;
    }
    const rep = active.slice().sort((a, b) => byId(a.shopId, b.shopId))[0];
    const mode = planOf(rep, list).mode;
    if (mode === 'group-nomerchant') {
      skipped.push({ shopIds, size: shopIds.length, reason: '共享 token 缺少 merchant_id，无法整组续期，需重新授权' });
      continue;
    }
    groups.push({ repShopId: String(rep.shopId), shopIds, size: shopIds.length, mode });
  }

  // 输出顺序稳定（便于展示与测试）：按组代表店铺 ID 排序
  groups.sort((a, b) => byId(a.repShopId, b.repShopId));
  skipped.sort((a, b) => byId(a.shopIds[0], b.shopIds[0]));
  return { groups, skipped };
}

module.exports = { planRefreshGroups };
