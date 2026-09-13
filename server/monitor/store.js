'use strict';
// 监控数据存储入口：server/data/monitor/ 下的规则覆盖 / 店铺配置 / 告警 / 快照 / meta。
// 原单文件持久化了 6 类数据，现按数据类型拆到 store/ 子目录，本入口只做聚合导出（对外 API 不变）。
// 全部为本地业务数据，不含凭证（shopId 仅作目录名/键）；写入失败仅告警不中断。
const rulesStore = require('./store/rules-store');
const configStore = require('./store/config-store');
const alertsStore = require('./store/alerts-store');
const snapshotStore = require('./store/snapshot-store');
const metaStore = require('./store/meta-store');

module.exports = {
  // 规则覆盖（store/rules-store.js）
  getRules: rulesStore.getRules,
  getRulesById: rulesStore.getRulesById,
  setRuleOverrides: rulesStore.setRuleOverrides,
  // 店铺配置：排除名单 + 金额模式（store/config-store.js）
  getExcludedShopIds: configStore.getExcludedShopIds,
  isMonitored: configStore.isMonitored,
  setExcludedShopIds: configStore.setExcludedShopIds,
  getCurrencyMode: configStore.getCurrencyMode,
  setCurrencyMode: configStore.setCurrencyMode,
  // 告警（store/alerts-store.js）
  loadAlerts: alertsStore.loadAlerts,
  saveAlerts: alertsStore.saveAlerts,
  // 快照（store/snapshot-store.js）
  appendSample: snapshotStore.appendSample,
  readTrend: snapshotStore.readTrend,
  // meta（store/meta-store.js）
  getMeta: metaStore.getMeta,
  patchMeta: metaStore.patchMeta,
  flushMeta: metaStore.flushMeta,
  clearData: metaStore.clearData,
};
