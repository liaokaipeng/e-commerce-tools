'use strict';
/**
 * 解压与包校验：
 *   - tarPath / probeTar / extractZip：复用共享层 lib/archive.js（系统自带 tar，不新增依赖）；
 *   - resolvePkgRoot / assertLooksLikePackage：识别真正的包根并确认是安装包。
 */
const fs = require('fs');
const path = require('path');

const { tarPath, probeTar, extractZip } = require('../lib/archive');

/** 压缩包可能把内容裹在一层顶层目录里（取决于打包方式），这里自动识别真正的包根 */
function resolvePkgRoot(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = entries.filter((e) => e.isFile());
  const dirs = entries.filter((e) => e.isDirectory());
  if (!files.length && dirs.length === 1) return path.join(dir, dirs[0].name);
  return dir;
}

/** 覆盖前先确认这确实是本工具的安装包，防止拿错包把程序目录写坏 */
function assertLooksLikePackage(dir) {
  const missing = ['server/main.js', 'package.json'].filter((f) => !fs.existsSync(path.join(dir, f)));
  if (missing.length) {
    throw new Error(`安装包内容不完整（缺少 ${missing.join('、')}），已终止更新`);
  }
}

module.exports = { tarPath, probeTar, extractZip, resolvePkgRoot, assertLooksLikePackage };
