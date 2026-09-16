'use strict';
/**
 * 递归扫描：从一个文件夹里找出所有视频文件（含子目录）。
 *
 * 两道自我保护：
 *   1. 跳过产物目录（默认 `compressed/`）与已带 OUT_SUFFIX 的文件——否则第二次执行会把
 *      上次的产物再压一遍，按钮点几次就越压越小；
 *   2. 记录 realpath 防止软链接成环把扫描卡死。
 * 上限 MAX_FILES 只为避免误选整块盘时刷爆浏览器（本地工具场景，正常目录远达不到）。
 */
const fs = require('fs');
const path = require('path');

const { VIDEO_EXT, SKIP_DIRS, OUT_SUFFIX } = require('./constants');

const MAX_FILES = 5000;

/** 是否为产物文件（上次压缩生成的，跳过以免重复压缩） */
function isOwnOutput(name) {
  return new RegExp(`${OUT_SUFFIX}\\.[^.]+$`, 'i').test(name);
}

/**
 * 递归收集视频文件。
 * @param {string} rootDir 起始目录（绝对路径）
 * @returns {{ root: string, files: Array<{path: string, rel: string, name: string, size: number, mtime: number}>,
 *             totalSize: number, truncated: boolean, emptyDirs: number }}
 */
function scanVideos(rootDir) {
  const root = path.resolve(rootDir);
  // 入口处就给出可读原因：fs 原始的 ENOENT / EPERM 直接抛给用户等于没说清哪里错了
  let st;
  try {
    st = fs.statSync(root);
  } catch {
    throw new Error('文件夹不存在或无法访问：' + root);
  }
  if (!st.isDirectory()) throw new Error('不是文件夹：' + root);

  const files = [];
  const visited = new Set();
  let truncated = false;
  let emptyDirs = 0;

  const walk = (dir) => {
    if (truncated) return;
    let real;
    try { real = fs.realpathSync(dir); } catch { return; }
    if (visited.has(real)) return;
    visited.add(real);

    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      emptyDirs += 1; // 无权限或已被删除，跳过但计数，便于排查「怎么少扫了目录」
      return;
    }

    for (const e of entries) {
      if (truncated) return;
      const fp = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name) || e.name.startsWith('.')) continue;
        walk(fp);
        continue;
      }
      if (!e.isFile()) continue;
      if (!VIDEO_EXT.has(path.extname(e.name).toLowerCase())) continue;
      if (isOwnOutput(e.name)) continue;

      let s;
      try { s = fs.statSync(fp); } catch { continue; }
      if (!s.size) continue; // 0 字节占位文件

      files.push({
        path: fp,
        rel: path.relative(root, fp).replace(/\\/g, '/'),
        name: e.name,
        size: s.size,
        mtime: s.mtimeMs,
      });
      if (files.length >= MAX_FILES) { truncated = true; return; }
    }
  };

  walk(root);
  files.sort((a, b) => a.rel.localeCompare(b.rel, 'zh-CN'));
  return {
    root,
    files,
    totalSize: files.reduce((n, f) => n + f.size, 0),
    truncated,
    emptyDirs,
  };
}

module.exports = { scanVideos, isOwnOutput, MAX_FILES };
