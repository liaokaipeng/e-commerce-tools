'use strict';
// meta 持久化：店铺名/当地币种/各指标最新值/各域采集状态，防抖落盘。
const fs = require('fs');
const { META_FILE, SNAPSHOT_DIR, ensureDirs, readJson, writeJson } = require('./paths');

let meta = readJson(META_FILE, { shops: {} });
if (!meta.shops || typeof meta.shops !== 'object') meta.shops = {};
let metaDirty = false;

function getMeta() {
  return meta;
}

/** 打补丁更新 meta 并防抖落盘 */
function patchMeta(fn) {
  try {
    fn(meta);
    metaDirty = true;
  } catch (e) {
    console.warn('[监控] 更新 meta 失败:', e.message);
  }
}

function flushMeta() {
  if (!metaDirty) return;
  metaDirty = false;
  writeJson(META_FILE, meta);
}

/** 清空监控数据（meta + 快照目录），供缓存清理调用；规则/店铺配置/金额模式保留。告警由 engine.clearAllAlerts 负责 */
function clearData() {
  meta = { shops: {} };
  metaDirty = true;
  flushMeta();
  try {
    fs.rmSync(SNAPSHOT_DIR, { recursive: true, force: true });
  } catch (e) {
    console.warn('[监控] 清空快照目录失败:', e.message);
  }
  ensureDirs();
}

// 防抖落盘定时器（unref 不阻塞进程退出）
const metaTimer = setInterval(flushMeta, 5000);
if (metaTimer.unref) metaTimer.unref();

module.exports = { getMeta, patchMeta, flushMeta, clearData };
