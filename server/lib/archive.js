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

/**
 * 校验 zip 内条目名的编码，返回「含非 ASCII 字节但未置 UTF-8 标志位（bit 11）」的条目名。
 *
 * 用途：bsdtar 默认按**当前代码页**（中文 Windows 即 GBK）写非 ASCII 条目名且不置标志位，
 * 这种包在非中文系统（Linux / macOS / 英文 Windows）解压会乱码（`启动.bat` → `????.bat`）。
 * 打包方必须加 `--options hdrcharset=UTF-8`（见 pack.js），本函数在打包后自检，
 * 避免老版本 libarchive 不认识该选项时静默产出坏包。
 *
 * @param {string} zipFile zip 绝对路径
 * @returns {{ total: number, bad: string[] }} bad 为未按 UTF-8 存储的条目名（按 latin1 还原，仅供报错展示）
 */
function zipNameEncoding(zipFile) {
  const buf = fs.readFileSync(zipFile);
  let eocd = -1;
  // 中央目录末尾记录（EOCD）在文件尾部；其后的注释最长 65535 字节，故最多回扫这么多
  for (let i = buf.length - 22; i >= 0 && i > buf.length - 22 - 65535; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) return { total: 0, bad: [] };
  const total = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  const bad = [];
  for (let n = 0; n < total; n++) {
    // 中央目录条目固定头 46 字节，签名 0x02014b50
    if (off + 46 > buf.length || buf.readUInt32LE(off) !== 0x02014b50) break;
    const flag = buf.readUInt16LE(off + 8);
    const nameLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const cmtLen = buf.readUInt16LE(off + 32);
    const name = buf.subarray(off + 46, off + 46 + nameLen);
    if ((flag & 0x800) === 0 && name.some((b) => b >= 0x80)) bad.push(name.toString('latin1'));
    off += 46 + nameLen + extraLen + cmtLen;
  }
  return { total, bad };
}

module.exports = { tarPath, probeTar, extractZip, zipNameEncoding };
