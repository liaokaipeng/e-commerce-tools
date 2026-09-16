'use strict';
/**
 * ffmpeg / ffprobe 的定位与自动安装
 *
 * 压缩必须依赖外部 ffmpeg 可执行文件：它不是 Node 包，因此不属于「新增运行时依赖」
 * （见 AGENTS.md 约束 2），也不进发布包（体积 ~180MB）。定位顺序：
 *   1. 环境变量 KP_FFMPEG（指定文件或所在目录）——给已自备 ffmpeg 的用户兜底；
 *   2. 仓库根 bin/ffmpeg.exe ——「一键下载」安装到这里（.gitignore 忽略，更新不覆盖）；
 *   3. 系统 PATH 上的 ffmpeg ——用户自己装过就直接用。
 * 两处都缺时由前端引导点「下载 ffmpeg」走 install()。
 */
const fs = require('fs');
const path = require('path');
const https = require('https');
const os = require('os');
const { spawnSync } = require('child_process');

const { probeTar, extractZip } = require('../lib/archive');
const { FFMPEG_SOURCES, FFMPEG_FILES } = require('./constants');

const ROOT = path.join(__dirname, '..', '..');
const BIN_DIR = path.join(ROOT, 'bin');
const IS_WIN = process.platform === 'win32';

/** 定位结果缓存（进程内一次即可，安装后会显式失效）。miss 也记下，避免每次请求都 spawn 探测 */
const probed = new Set();
let cached = {};

function exeName(base) {
  return IS_WIN ? base + '.exe' : base;
}

/** 「一键下载」的安装目录（也用于前端展示给用户手动放文件） */
function binDir() {
  return BIN_DIR;
}

/** 逐个候选文件取第一个 -version 能跑通的；跑不通（不存在 / 缺 DLL）一律跳过 */
function probeExe(p, base) {
  if (!p) return null;
  const st = fs.existsSync(p) ? fs.statSync(p) : null;
  const target = st && st.isDirectory() ? path.join(p, exeName(base)) : p;
  if (!fs.existsSync(target)) return null;
  const r = spawnSync(target, ['-version'], { encoding: 'utf8', timeout: 15000 });
  if (r.error || r.status !== 0) return null;
  const m = /^(ffmpeg|ffprobe) version (\S+)/m.exec(String(r.stdout || ''));
  return { path: target, version: m ? m[2] : 'unknown' };
}

/** 环境变量 KP_FFMPEG 可指向单个 exe，也可指向含两个 exe 的目录 */
function envCandidates(base) {
  const v = String(process.env.KP_FFMPEG || '').trim();
  if (!v) return [];
  return [v, path.join(v, exeName(base))];
}

/** 候选顺序：bin/ffmpeg.exe → 环境变量 → PATH → 常见安装位置 */
function candidates(base) {
  return [
    path.join(BIN_DIR, exeName(base)),
    ...envCandidates(base),
    base, // 交给 PATH 解析
    path.join('C:\\ffmpeg', 'bin', exeName(base)),
    path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'WinGet', 'Links', exeName(base)),
  ].filter(Boolean);
}

function findTool(base, force) {
  if (!force && probed.has(base)) return cached[base];
  let hit = null;
  for (const c of candidates(base)) {
    hit = probeExe(c, base);
    if (hit) break;
  }
  cached[base] = hit;
  probed.add(base);
  return hit;
}

/** ffmpeg（含 ffprobe）是否可用 */
function resolve(force = false) {
  const ffmpeg = findTool('ffmpeg', force);
  const ffprobe = findTool('ffprobe', force);
  return {
    ready: !!(ffmpeg && ffprobe),
    ffmpeg: ffmpeg ? ffmpeg.path : null,
    ffprobe: ffprobe ? ffprobe.path : null,
    version: ffmpeg ? ffmpeg.version : null,
  };
}

/** 清缓存：安装完成或测试用例切换环境时调用 */
function reset() {
  probed.clear();
  cached = {};
}

// ============ 自动安装（下载构建包 → 解压 → 抽出两个 exe 落到 bin/） ============

/**
 * 下载到本地文件：跟随跳转、支持中途判断放弃。
 * @param {string} url
 * @param {string} dest
 * @param {(received: number, total: number) => void} onProgress
 * @param {() => boolean} shouldAbort
 */
function download(url, dest, onProgress, shouldAbort) {
  return new Promise((resolve, reject) => {
    const go = (u, depth) => {
      if (depth > 5) return reject(new Error('重定向次数过多'));
      if (shouldAbort && shouldAbort()) return reject(new Error('已取消'));
      const req = https.get(u, { timeout: 30000, headers: { 'User-Agent': 'kp-tools' } }, (res) => {
        if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
          res.resume();
          return go(new URL(res.headers.location, u).href, depth + 1);
        }
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`下载失败（HTTP ${res.statusCode}）`));
        }
        const total = Number(res.headers['content-length'] || 0);
        let received = 0;
        const out = fs.createWriteStream(dest);
        res.on('data', (c) => {
          received += c.length;
          if (onProgress) onProgress(received, total);
          // 主动放弃时销毁流，避免把整个包下完
          if (shouldAbort && shouldAbort()) { req.destroy(); reject(new Error('已取消')); }
        });
        res.pipe(out);
        out.on('finish', () => resolve({ received, total }));
        out.on('error', reject);
        res.on('error', reject);
      });
      req.on('timeout', () => { req.destroy(); reject(new Error('下载超时')); });
      req.on('error', reject);
    };
    go(url, 0);
  });
}

/** 在解压目录里递归找 bin/ffmpeg.exe 与 bin/ffprobe.exe，返回 { ffmpeg: abs, ffprobe: abs } */
function pickBinaries(dir) {
  const found = {};
  const walk = (d, depth) => {
    if (depth > 5 || Object.keys(found).length === FFMPEG_FILES.length) return;
    let entries;
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const fp = path.join(d, e.name);
      if (e.isDirectory()) { walk(fp, depth + 1); continue; }
      const hit = FFMPEG_FILES.find((f) => f === e.name);
      if (hit && !found[hit.slice(0, -4)]) found[hit.slice(0, -4)] = fp;
    }
  };
  walk(dir, 0);
  return found;
}

/**
 * 一键安装 ffmpeg：按 FFMPEG_SOURCES 逐个源尝试「下载 → 解压 → 抽 exe → 落到 bin/」。
 * @param {(ev: object) => void} emit 进度回调（{ phase, ... }）
 * @param {() => boolean} shouldAbort 中途放弃判断（任务取消）
 * @returns {Promise<{ffmpeg: string, ffprobe: string, version: string, source: string}>}
 */
async function install(emit = () => {}, shouldAbort = () => false) {
  if (!IS_WIN) throw new Error('自动安装目前仅支持 Windows，请自行安装 ffmpeg 并保证 ffmpeg/ffprobe 在 PATH 中。');
  const tar = probeTar();
  if (!tar.ok) throw new Error(tar.message);

  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'kp-ffmpeg-'));
  const zipFile = path.join(work, 'ffmpeg.zip');
  const extractDir = path.join(work, 'pkg');
  const errors = [];
  try {
    for (const src of FFMPEG_SOURCES) {
      if (shouldAbort()) throw new Error('已取消');
      emit({ phase: 'source', name: src.name });
      try {
        await download(src.url, zipFile, (received, total) => {
          emit({
            phase: 'download',
            name: src.name,
            received,
            total,
            percent: total ? Math.floor((received / total) * 100) : null,
          });
        }, shouldAbort);

        emit({ phase: 'extract', name: src.name });
        extractZip(zipFile, extractDir);

        const bin = pickBinaries(extractDir);
        if (!bin.ffmpeg || !bin.ffprobe) {
          throw new Error('构建包里没有找到 ffmpeg.exe / ffprobe.exe');
        }
        fs.mkdirSync(BIN_DIR, { recursive: true });
        for (const key of ['ffmpeg', 'ffprobe']) {
          fs.copyFileSync(bin[key], path.join(BIN_DIR, exeName(key)));
        }
        reset();
        const st = resolve(true);
        if (!st.ready) throw new Error('安装后仍无法执行 ffmpeg，可能是杀毒软件拦截或文件不完整');
        emit({ phase: 'done', name: src.name, version: st.version });
        return { ffmpeg: st.ffmpeg, ffprobe: st.ffprobe, version: st.version, source: src.name };
      } catch (e) {
        if (shouldAbort()) throw e;
        errors.push(`${src.name}：${e.message}`);
        emit({ phase: 'source-failed', name: src.name, message: e.message });
        // 换下一个源前清掉半成品
        try { fs.rmSync(zipFile, { force: true }); } catch { /* ignore */ }
        try { fs.rmSync(extractDir, { recursive: true, force: true }); } catch { /* ignore */ }
      }
    }
    throw new Error('所有下载源都失败了：' + errors.join('；'));
  } finally {
    try { fs.rmSync(work, { recursive: true, force: true }); } catch { /* 临时目录清理失败不影响结果 */ }
  }
}

module.exports = { resolve, reset, install, binDir, BIN_DIR };
