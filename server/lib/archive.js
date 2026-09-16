'use strict';
/**
 * 系统自带 tar 的定位与 zip 解压（共享层）
 *
 * 本仓库不引入额外解压依赖（见 AGENTS.md 约束 2）：Windows 10 1803+ 自带 bsdtar
 * （`%SystemRoot%\System32\tar.exe`），它同时支持 zip 与 tar。
 *
 * 调用方：一键更新（server/update/apply.js，解发布包）、ffmpeg 自动安装
 * （server/compress/ffmpeg.js，解构建包）、发布打包（pack.js，压 zip）。
 * 此前 tarPath 在 update/archive.js 与 pack.js 各写一份，这里收敛为唯一实现。
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
      message: '系统未找到 tar 命令（Windows 10 1803 及以上自带），无法自动解压。',
    };
  }
  return { ok: true };
}

/**
 * 解压 zip 到目标目录（目录不存在会自动创建）。
 * @param {string} zipFile zip 绝对路径
 * @param {string} destDir 目标目录
 */
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

module.exports = { tarPath, probeTar, extractZip };
