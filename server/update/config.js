'use strict';
/**
 * 更新配置与路径/超时常量（单一来源）
 *
 * 设计约束（与仓库「极简零配置」一致）：
 *   - **不引入环境变量**：清单地址读 server/config/update.json（随包分发、由发布方填写）；
 *     单机若需指向别的镜像，写 server/data/update-config.json（data 目录永不被更新覆盖）。
 */
const os = require('os');
const path = require('path');

const version = require('../lib/version');
const { readJson } = require('../lib/json-file');

const ROOT = version.ROOT;
const DATA_DIR = path.join(__dirname, '..', 'data');
const CONFIG_FILE = path.join(__dirname, '..', 'config', 'update.json');
const OVERRIDE_FILE = path.join(DATA_DIR, 'update-config.json');
const CACHE_FILE = path.join(DATA_DIR, 'update-cache.json');
// 下载与解压的临时工作区放系统临时目录：既不污染 server/data 的备份，也不占包内体积
const WORK_ROOT = path.join(os.tmpdir(), 'kp_tools-update');
// 更新前的数据备份（已 gitignore）
const BACKUP_DIR = path.join(ROOT, 'backup');

const CHECK_TIMEOUT_MS = 8000;
const DOWNLOAD_TIMEOUT_MS = 180000;

/**
 * 生效配置：随包分发的 config/update.json ← 本机覆盖 server/data/update-config.json（后者优先）。
 * manifestUrl 留空即视为关闭更新检查（新克隆的仓库默认如此）。
 */
function loadConfig() {
  const base = readJson(CONFIG_FILE) || {};
  const override = readJson(OVERRIDE_FILE) || {};
  const manifestUrl = String(override.manifestUrl || base.manifestUrl || '').trim();
  return {
    enabled: base.enabled !== false,
    intervalHours: Number(override.intervalHours || base.intervalHours) || 6,
    manifestUrl,
    configured: !!manifestUrl,
  };
}

module.exports = {
  ROOT,
  DATA_DIR,
  CONFIG_FILE,
  OVERRIDE_FILE,
  CACHE_FILE,
  WORK_ROOT,
  BACKUP_DIR,
  CHECK_TIMEOUT_MS,
  DOWNLOAD_TIMEOUT_MS,
  loadConfig,
};
