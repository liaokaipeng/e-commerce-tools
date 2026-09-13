'use strict';
// 大屏配置视图与副作用编排：监控店铺排除名单 / 金额展示模式的读取与保存。
// 供 monitor.js 的 /api/monitor/shops-config、/api/monitor/currency-config 取用，
// 路由层只负责参数校验与 sendJson。
const store = require('../store');
const engine = require('../engine');
const scheduler = require('../scheduler');
const { ensureRates } = require('../currency');
const openapiStore = require('../../openapi/store');

/** 监控店铺配置读取：全部已授权店铺及其监控状态（含未监控的，供配置面板勾选） */
function buildShopsConfig() {
  const excluded = store.getExcludedShopIds();
  const shops = scheduler.status().shops.map((s) => ({
    shopId: s.shopId,
    name: s.name || '',
    authBroken: !!s.authBroken,
    monitored: !excluded.has(s.shopId),
  }));
  return { ok: true, configured: openapiStore.status().configured, shops };
}

/** 保存排除名单并编排副作用，返回响应体：新排除的店铺关闭其未关闭告警 + 通知调度 + 广播 */
function saveShopsConfig(excludedShopIds) {
  const before = store.getExcludedShopIds();
  const after = store.setExcludedShopIds(excludedShopIds);
  // 新排除的店铺：关闭其未关闭告警（不再占用大屏统计）；重新勾选后采集触发会重新打开
  for (const id of after) {
    if (!before.has(id)) engine.closeShopAlerts(id);
  }
  scheduler.notifyConfigChanged();
  engine.broadcast('config', { at: Date.now() });
  return { ok: true, excludedShopIds: [...after], message: '监控店铺配置已保存' };
}

/** 金额单位模式读取（默认 local 当地货币） */
function buildCurrencyConfig() {
  return { ok: true, mode: store.getCurrencyMode() };
}

/** 保存金额模式并编排副作用，返回响应体：有店铺时顺带刷新汇率（异步，不阻塞响应）+ 广播 */
function saveCurrencyConfig(rawMode) {
  const mode = store.setCurrencyMode(String(rawMode || ''));
  if (openapiStore.status().shops.length) ensureRates();
  engine.broadcast('config', { at: Date.now() });
  return {
    ok: true,
    mode,
    message: mode === 'rmb' ? '金额展示已切换为人民币（阈值仍按人民币比较）' : '金额展示已切换为当地货币（阈值仍按人民币比较）',
  };
}

module.exports = { buildShopsConfig, saveShopsConfig, buildCurrencyConfig, saveCurrencyConfig };
