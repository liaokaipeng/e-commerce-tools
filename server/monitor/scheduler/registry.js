'use strict';
// 店铺注册表：从开放平台凭证读取已授权店铺，维护监控/授权状态与最近执行时间。
const engine = require('../engine');
const store = require('../store');
const openapiStore = require('../../openapi/store');
const { state } = require('./state');

function metaShop(shopId) {
  const meta = store.getMeta();
  const m = meta.shops[shopId] || {};
  return {
    name: m.name || '',
    lastRun: m.lastRun || {},
    failCount: m.failCount || {},
    consecutiveFails: m.consecutiveFails || 0,
    unsupported: m.unsupported || {},
    currency: m.currency || '',
  };
}

/** 从开放平台凭证读取已授权店铺（未配置 App 时返回空数组） */
function refreshShops() {
  const st = openapiStore.status();
  if (!st.configured) {
    state.shops = [];
    return;
  }
  // 「重点店铺」筛选：开放平台页勾选了任一重点店铺时，监控范围收窄到重点店铺；
  // 一个都没勾选则维持全部已授权店铺（回落语义，保证零配置下与从前一致）。
  const importantIds = new Set(openapiStore.getImportantIds(st.env));
  const onlyImportant = importantIds.size > 0;
  const prevIds = new Set(state.shops.map((s) => s.shopId));
  const byId = new Map(state.shops.map((s) => [s.shopId, s]));
  state.shops = st.shops
    .filter((s) => !onlyImportant || importantIds.has(s.shopId))
    .map((s) => {
      const old = byId.get(s.shopId);
      const authBroken = s.state === 're_auth';
      if (authBroken) {
        // 凭证已死透的店铺停止采集；旧的「采集连续失败」告警关闭（界面以「待重新授权」呈现），
        // 重新授权后 collection 成功会重新开新告警（如有需要）
        engine.closeAlert(s.shopId + ':system.collect_fail');
      }
      return {
        shopId: s.shopId,
        name: (old && old.name) || metaShop(s.shopId).name || '',
        authBroken,
        monitored: store.isMonitored(s.shopId),
      };
    });
  // 因「取消重点标记」或授权被删而离开监控范围的店铺：关闭其未关闭告警，
  // 否则这些告警仍会随 SSE 推到大屏并占用统计（与「停用监控即关闭告警」口径一致）。
  const nextIds = new Set(state.shops.map((s) => s.shopId));
  for (const id of prevIds) if (!nextIds.has(id)) engine.closeShopAlerts(id);
  // 恢复内存中的最近执行时间（重启后避免立刻重复采集）
  if (!state.lastRun || !Object.keys(state.lastRun).length) {
    for (const s of state.shops) state.lastRun[s.shopId] = Object.assign({}, metaShop(s.shopId).lastRun);
  }
}

module.exports = { metaShop, refreshShops };
