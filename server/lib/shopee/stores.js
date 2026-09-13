'use strict';
/**
 * 店铺名映射（shopId -> 店铺名，热载）
 *
 * 原 config/stores.json 手工清单已删除（与真实授权店铺漂移，且各页下拉早已改用 /api/openapi/stores）。
 * 现在与开放平台同一数据源：openapi-session.json 的 shopName 优先，缺失时退回监控 meta.json 的
 * name（首次采集时经 get_shop_info 补过）。每次实时读取，授权/改名后自动跟随，无需人工维护。
 */
const { readJson } = require('../json-file');
const { OPENAPI_SESSION_FILE, MONITOR_META_FILE } = require('./constants');

/** 店铺名映射 `{ shopId: name }`，取不到名字的店铺不出现在结果里（调用方自行回落为裸 shopId） */
function loadStoreNames() {
  const out = {};
  const meta = readJson(MONITOR_META_FILE);
  for (const [id, m] of Object.entries((meta && meta.shops) || {})) {
    if (m && m.name) out[String(id)] = String(m.name);
  }
  const session = readJson(OPENAPI_SESSION_FILE);
  const env = (session && session.app && session.app.env) || 'prod';
  const shops = (session && session.shops && session.shops[env]) || {};
  for (const [id, s] of Object.entries(shops)) {
    if (s && s.shopName) out[String(id)] = String(s.shopName);
  }
  return out;
}

/** 取单个店铺名，取不到时回落为裸 shopId（日志/结果行展示用） */
function storeNameOf(shopId, map) {
  return (map && map[String(shopId)]) || String(shopId);
}

module.exports = { loadStoreNames, storeNameOf };
