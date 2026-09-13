'use strict';
/**
 * 解压与包校验：
 *   - tarPath / probeTar：定位并使用系统自带 tar（不新增运行时依赖）；
 *   - extractZip：调 tar 解压 zip；
 *   - resolvePkgRoot / assertLooksLikePackage：识别真正的包根并确认是安装包。
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

/** 系统自带 tar 的绝对路径（避免 PATH 上出现 GNU tar —— 它不支持 zip） */
function tarPath() {
  const sysTar = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
  return fs.existsSync(sysTar) ? sysTar : 'tar';
}

/** 探测解压能力；缺失时返回可执行的手动方案，而不是让流程静默失败 */
function probeTar() {
  const r = spawnSync(tarPath(), ['--version'], { encoding: 'utf8' });
  if (r.error || r.status !== 0) {
    return {
      ok: false,
      message: '系统未找到 tar 命令（Windows 10 1803 及以上自带），无法自动解压。'
        + '请点「下载安装包」手动覆盖更新。',
    };
  }
  return { ok: true };
}

function extractZip(zipFile, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  const r = spawnSync(tarPath(), ['-xf', zipFile, '-C', destDir], {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  if (r.error) throw new Error('解压失败（无法执行 tar）：' + r.error.message);
  if (r.status !== 0) {
    throw new Error('解压失败：' + String(r.stderr || r.stdout || '').trim());
  }
}

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
