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
  const byId = new Map(state.shops.map((s) => [s.shopId, s]));
  state.shops = st.shops.map((s) => {
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
  // 恢复内存中的最近执行时间（重启后避免立刻重复采集）
  if (!state.lastRun || !Object.keys(state.lastRun).length) {
    for (const s of state.shops) state.lastRun[s.shopId] = Object.assign({}, metaShop(s.shopId).lastRun);
  }
}

module.exports = { metaShop, refreshShops };
