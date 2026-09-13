'use strict';
// 监控数据文件路径与 JSON 读写底座：server/data/monitor/ 下
//   rules.json      用户对默认规则的覆盖（阈值/开关），未覆盖项走 constants.DEFAULT_RULES
//   config.json     监控店铺配置（excludedShopIds 排除名单 + currencyMode 金额模式）
//   alerts.json     告警全量（含状态，引擎变更后防抖落盘）
//   meta.json       店铺名缓存 / 各指标最新值 / 各域最近采集时间与失败次数
//   snapshots/{shopId}/{metric}/YYYY-MM-DD.json  当日采样数组 [{at, v}]
// 全部为本地业务数据，不含凭证（shopId 仅作目录名/键）；写入失败仅告警不中断。
const fs = require('fs');
const path = require('path');
const { readJson: readJsonRaw, writeJson: writeJsonRaw } = require('../../lib/json-file');
const { DATA_DIR } = require('../constants');

const RULES_FILE = path.join(DATA_DIR, 'rules.json');
const ALERTS_FILE = path.join(DATA_DIR, 'alerts.json');
const META_FILE = path.join(DATA_DIR, 'meta.json');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');
const SNAPSHOT_DIR = path.join(DATA_DIR, 'snapshots');

function ensureDirs() {
  fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });
}

// JSON 读写走共享层 lib/json-file.js，这里只附加「监控数据文件」的告警策略
function readJson(file, fallback) {
  return readJsonRaw(file, fallback, (e) => console.warn('[监控] 读取数据文件失败（' + file + '）:', e.message));
}

function writeJson(file, data) {
  try {
    writeJsonRaw(file, data);
    return true;
  } catch (e) {
    console.warn('[监控] 保存数据文件失败（' + file + '）:', e.message);
    return false;
  }
}

ensureDirs();

module.exports = {
  RULES_FILE,
  ALERTS_FILE,
  META_FILE,
  CONFIG_FILE,
  SNAPSHOT_DIR,
  ensureDirs,
  readJson,
  writeJson,
};
