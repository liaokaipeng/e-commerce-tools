'use strict';
/**
 * 覆盖白名单与文件合并/备份：
 *   - COPY_ITEMS：发布包与一键更新共用同一份，避免「包里有、更新不覆盖」这类漂移；
 *   - mergeCopy：递归合并复制（只覆盖、不删除）；
 *   - backupData / copyWhitelist：更新前的数据备份与按白名单覆盖程序文件。
 */
const fs = require('fs');
const path = require('path');

const { ROOT, DATA_DIR, BACKUP_DIR } = require('./config');

/**
 * 一键更新覆盖白名单（发布包与更新共用同一份，避免两处漂移）：
 * 只覆盖「程序」，不含任何用户数据。`server` 复制时额外跳过 `data` 子目录。
 * `docs/`（开发指南与 `shopee_api_doc/` 官方文档目录）**属开发资料，既不进发布包也不下发给使用者**，故不列入。
 */
const COPY_ITEMS = [
  'server',
  'frontend/dist',
  'extension',
  '启动.bat',
  'package.json',
  'package-lock.json',
  '新手入门指南.md',
];

/**
 * 递归合并复制：把 src 的内容覆盖进 dest。
 * 只覆盖、不删除 —— 更新包里没有的本地文件（如 node_modules、用户自建脚本）保持原样。
 * @param {string} src 源路径
 * @param {string} dest 目标路径
 * @param {string[]} [skipNames] 命中的目录/文件名整棵跳过（用于排除 server/data）
 */
function mergeCopy(src, dest, skipNames = []) {
  if (skipNames.includes(path.basename(src))) return;
  const st = fs.statSync(src);
  if (st.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    for (const e of fs.readdirSync(src, { withFileTypes: true })) {
      mergeCopy(path.join(src, e.name), path.join(dest, e.name), skipNames);
    }
    return;
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

/** 覆盖前整目录备份 server/data（真实店铺授权、Cookie、SPU 配置都在这里） */
function backupData(ts) {
  if (!fs.existsSync(DATA_DIR)) return null;
  const dest = path.join(BACKUP_DIR, `data-${ts}`);
  mergeCopy(DATA_DIR, dest);
  return path.relative(ROOT, dest).replace(/\\/g, '/');
}

/** 按白名单覆盖程序文件；`server` 里跳过 data 子目录 */
function copyWhitelist(pkgRoot) {
  const copied = [];
  for (const item of COPY_ITEMS) {
    const src = path.join(pkgRoot, item);
    if (!fs.existsSync(src)) continue;
    mergeCopy(src, path.join(ROOT, item), item === 'server' ? ['data'] : []);
    copied.push(item);
  }
  return copied;
}

module.exports = { COPY_ITEMS, mergeCopy, backupData, copyWhitelist };
