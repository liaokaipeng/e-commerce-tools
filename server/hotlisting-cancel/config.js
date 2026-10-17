'use strict';
// 各店铺 SPU 配置持久化（shopId -> SPU 文本）。文件位于 server/data（gitignored）。
const { readJson, writeJson } = require('../lib/json-file');
const { SPU_CONFIG_FILE } = require('./constants');

function loadSpuConfig() {
  // 文件不存在属正常（尚未配置）；损坏才告警——否则用户看到的是「未配置 SPU」而非「配置文件损坏」
  const map = readJson(SPU_CONFIG_FILE, {}, (e) => {
    if (e.code !== 'ENOENT') console.warn('读取 SPU 配置文件失败（按未配置处理）:', e.message);
  });
  return map && typeof map === 'object' ? map : {};
}

function saveSpuConfig(map) {
  writeJson(SPU_CONFIG_FILE, map);
}

module.exports = { loadSpuConfig, saveSpuConfig };
