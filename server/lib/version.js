'use strict';
/**
 * 版本信息与版本号比较（单一来源）
 *
 * 版本号**只**来自仓库根 package.json 的 `version`：打包、前端显示、更新比对三处都读它，
 * 避免各写一份造成漂移。`server/build-info.json`（由 `npm run pack` 生成，不入库）只补充
 * commit 与构建时间，开发树里没有该文件属正常情况（返回 null）。
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const PKG_FILE = path.join(ROOT, 'package.json');
const BUILD_INFO_FILE = path.join(__dirname, '..', 'build-info.json');

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); }
  catch { return null; }
}

/** 当前版本号（package.json 的 version；读不到时回退 0.0.0，便于比对永远判为「有新版」） */
function currentVersion() {
  const pkg = readJson(PKG_FILE);
  return (pkg && pkg.version) || '0.0.0';
}

/** 构建信息（打包时写入 build-info.json；开发树下返回 {}） */
function buildInfo() {
  return readJson(BUILD_INFO_FILE) || {};
}

/** 对外统一版本描述 */
function info() {
  const b = buildInfo();
  return {
    version: currentVersion(),
    commit: b.commit || null,
    builtAt: b.builtAt || null,
  };
}

/** 把 "v1.2.3-beta" 之类的版本号归一为 [major, minor, patch] */
function parseVersion(v) {
  const parts = String(v || '').trim().replace(/^v/i, '').split('.');
  const out = [];
  for (let i = 0; i < 3; i++) {
    const n = parseInt(parts[i], 10);
    out.push(Number.isFinite(n) ? n : 0);
  }
  return out;
}

/**
 * 比较两个版本号（只认 major.minor.patch）
 * @returns {number} a > b 返回 1，a < b 返回 -1，相等返回 0
 */
function compareVersions(a, b) {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] > pb[i] ? 1 : -1;
  }
  return 0;
}

module.exports = { ROOT, currentVersion, buildInfo, info, compareVersions, parseVersion };
