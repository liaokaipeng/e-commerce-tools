'use strict';
// 各店铺 SPU 配置持久化（shopId -> SPU 文本）。文件位于 server/data（gitignored）。
const fs = require('fs');
const path = require('path');
const { SPU_CONFIG_FILE } = require('./constants');

function loadSpuConfig() {
  try {
    const map = JSON.parse(fs.readFileSync(SPU_CONFIG_FILE, 'utf8'));
    return map && typeof map === 'object' ? map : {};
  } catch (e) {
    return {};
  }
}

function saveSpuConfig(map) {
  fs.mkdirSync(path.dirname(SPU_CONFIG_FILE), { recursive: true });
  fs.writeFileSync(SPU_CONFIG_FILE, JSON.stringify(map, null, 2), 'utf8');
}

module.exports = { loadSpuConfig, saveSpuConfig };
