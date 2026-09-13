'use strict';
/**
 * 版本与自更新
 *
 *   GET  /api/version        当前版本（package.json 的 version + 打包时写入的 commit / 构建时间）
 *   GET  /api/update/check   拉取远端清单并比对，返回是否有新版本（失败时回落到本地上次结果）
 *   POST /api/update/apply   一键更新（SSE 进度）：下载 → 校验 sha256 → 解压 → 备份数据 → 白名单覆盖 → 依赖差异安装
 *
 * 设计约束（与仓库「极简零配置」一致）：
 *   - **不新增运行时依赖**：下载用 Node 内置 fetch，解压调用系统自带的 tar（Win10 1803+ 内置 bsdtar）。
 *     探测不到 tar 时明确报错并降级为「手动下载覆盖」，不静默失败、也不为此引入 npm 包。
 *   - **不引入环境变量**：清单地址读 server/config/update.json（随包分发、由发布方填写）；
 *     单机若需指向别的镜像，写 server/data/update-config.json（data 目录永不被更新覆盖）。
 *   - **更新只按白名单覆盖，绝不动 server/data/**（真实店铺授权与 Cookie）、node_modules 与用户导出文件；
 *     覆盖前先把 server/data 整目录备份到 backup/data-<时间戳>。
 *   - 程序文件落盘后**必须重启服务才生效**（后端模块已加载进内存），接口如实返回 restartRequired。
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const { Readable, Transform } = require('stream');
const { pipeline } = require('stream/promises');

const { sendJson, sse } = require('./lib/http-utils');
const version = require('./lib/version');

const ROOT = version.ROOT;
const DATA_DIR = path.join(__dirname, 'data');
const CONFIG_FILE = path.join(__dirname, 'config', 'update.json');
const OVERRIDE_FILE = path.join(DATA_DIR, 'update-config.json');
const CACHE_FILE = path.join(DATA_DIR, 'update-cache.json');
// 下载与解压的临时工作区放系统临时目录：既不污染 server/data 的备份，也不占包内体积
const WORK_ROOT = path.join(os.tmpdir(), 'kp_tools-update');
// 更新前的数据备份（已 gitignore）
const BACKUP_DIR = path.join(ROOT, 'backup');

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

const CHECK_TIMEOUT_MS = 8000;
const DOWNLOAD_TIMEOUT_MS = 180000;

// ============ 配置 ============

function readJsonFile(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); }
  catch { return null; }
}

/**
 * 生效配置：随包分发的 config/update.json ← 本机覆盖 server/data/update-config.json（后者优先）。
 * manifestUrl 留空即视为关闭更新检查（新克隆的仓库默认如此）。
 */
function loadConfig() {
  const base = readJsonFile(CONFIG_FILE) || {};
  const override = readJsonFile(OVERRIDE_FILE) || {};
  const manifestUrl = String(override.manifestUrl || base.manifestUrl || '').trim();
  return {
    enabled: base.enabled !== false,
    intervalHours: Number(override.intervalHours || base.intervalHours) || 6,
    manifestUrl,
    configured: !!manifestUrl,
  };
}

// ============ 清单拉取与比对 ============

async function fetchJson(url, timeoutMs = CHECK_TIMEOUT_MS) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      signal: ctrl.signal,
      headers: { 'Cache-Control': 'no-cache', Pragma: 'no-cache' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (e) {
    if (e && e.name === 'AbortError') throw new Error('请求超时');
    throw new Error((e && e.message) || String(e));
  } finally {
    clearTimeout(timer);
  }
}

/** 由清单字段组装对外快照（含 hasUpdate 判定） */
function snapshot(src, currentVersionStr) {
  const latest = src && src.latest ? String(src.latest) : null;
  return {
    latest,
    url: (src && src.url) || '',
    sha256: (src && src.sha256) || '',
    notes: (src && src.notes) || '',
    builtAt: (src && src.builtAt) || null,
    checkedAt: (src && src.checkedAt) || null,
    // 只有明确拿到比当前更高的版本号才算「有新版」，避免清单写错导致误报
    hasUpdate: !!(latest && version.compareVersions(latest, currentVersionStr) > 0),
  };
}

/**
 * 检查更新：拉取远端清单比对当前版本。
 * 网络失败时**不抛错**，而是带着 error 字段回落上次缓存的结果，前端据此显示「检查失败（仍可继续使用）」。
 */
async function checkNow() {
  const cfg = loadConfig();
  const current = version.info();
  const cached = readJsonFile(CACHE_FILE) || {};
  const base = {
    enabled: cfg.enabled,
    configured: cfg.configured,
    manifestUrl: cfg.manifestUrl,
    current,
    error: null,
    ...snapshot(cached, current.version),
  };
  if (!cfg.enabled || !cfg.configured) return base;

  try {
    const manifest = await fetchJson(cfg.manifestUrl);
    const latest = String((manifest && manifest.version) || '').trim();
    if (!latest) throw new Error('清单缺少 version 字段');
    const fresh = {
      latest,
      url: String(manifest.url || '').trim(),
      sha256: String(manifest.sha256 || '').trim(),
      notes: String(manifest.notes || ''),
      builtAt: manifest.builtAt || null,
      checkedAt: new Date().toISOString(),
    };
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(CACHE_FILE, JSON.stringify(fresh, null, 2), 'utf8');
    } catch { /* 缓存写不了不影响本次结果 */ }
    return { ...base, error: null, ...snapshot(fresh, current.version) };
  } catch (e) {
    return { ...base, error: (e && e.message) || String(e) };
  }
}

// ============ 解压与文件操作 ============

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

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/** 流式下载并同步计算 sha256（大包不整块进内存） */
async function downloadTo(url, dest, onProgress) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), DOWNLOAD_TIMEOUT_MS);
  try {
    const res = await fetch(url, { redirect: 'follow', signal: ctrl.signal });
    if (!res.ok) throw new Error(`下载失败：HTTP ${res.status}`);
    const total = Number(res.headers.get('content-length') || 0);
    const hash = crypto.createHash('sha256');
    let received = 0;
    const meter = new Transform({
      transform(chunk, _enc, cb) {
        hash.update(chunk);
        received += chunk.length;
        if (onProgress) onProgress(received, total);
        cb(null, chunk);
      },
    });
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    await pipeline(Readable.fromWeb(res.body), meter, fs.createWriteStream(dest));
    return { size: received, sha256: hash.digest('hex') };
  } catch (e) {
    if (e && e.name === 'AbortError') throw new Error('下载超时，请检查网络后重试');
    throw new Error((e && e.message) || String(e));
  } finally {
    clearTimeout(timer);
  }
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

function depsDiffer(a = {}, b = {}) {
  const norm = (o) => JSON.stringify(Object.keys(o).sort().map((k) => [k, o[k]]));
  return norm(a) !== norm(b);
}

// ============ 更新执行 ============

function step(emit, phase, message, extra) {
  emit(Object.assign({ phase, message }, extra || {}));
}

/**
 * 执行一键更新。emit 为 SSE 事件发射器（见 lib/http-utils 的 sse）。
 * @returns {Promise<object>} 更新结果（含版本、备份目录、是否需要重启）
 */
async function applyUpdate(emit) {
  const cfg = loadConfig();
  if (!cfg.configured) throw new Error('未配置更新清单地址，无法自动更新（见 server/config/update.json）');

  step(emit, 'check', '正在读取版本清单…');
  const remote = await checkNow();
  if (remote.error) throw new Error('获取版本清单失败：' + remote.error);
  if (!remote.hasUpdate) throw new Error(`当前已是最新版本（v${remote.current.version}）`);
  if (!remote.url) throw new Error('清单缺少下载地址 url');
  if (!remote.sha256) throw new Error('清单缺少 sha256 校验值，为安全起见不自动更新');

  const probe = probeTar();
  if (!probe.ok) throw new Error(probe.message);

  const ts = stamp();
  const work = path.join(WORK_ROOT, ts);
  const zipFile = path.join(work, 'pkg.zip');
  const extractDir = path.join(work, 'pkg');

  step(emit, 'download', `正在下载 v${remote.latest}…`);
  const dl = await downloadTo(remote.url, zipFile, (received, total) => {
    step(emit, 'download', `正在下载 v${remote.latest}…`, {
      percent: total ? Math.floor((received / total) * 100) : null,
      received,
      total,
    });
  });

  step(emit, 'verify', '正在校验安装包…');
  if (dl.sha256.toLowerCase() !== remote.sha256.toLowerCase()) {
    throw new Error('安装包校验失败（sha256 不一致），已终止更新。'
      + `期望 ${remote.sha256.slice(0, 12)}…，实际 ${dl.sha256.slice(0, 12)}…`);
  }

  step(emit, 'extract', '正在解压…');
  extractZip(zipFile, extractDir);
  const pkgRoot = resolvePkgRoot(extractDir);
  assertLooksLikePackage(pkgRoot);

  step(emit, 'backup', '正在备份 server/data…');
  const backup = backupData(ts);

  step(emit, 'copy', '正在覆盖程序文件…');
  const copied = copyWhitelist(pkgRoot);

  step(emit, 'deps', '正在检查依赖变化…');
  const oldPkg = readJsonFile(path.join(ROOT, 'package.json')) || {};
  const newPkg = readJsonFile(path.join(pkgRoot, 'package.json')) || {};
  let depsInstalled = false;
  let depsWarning = null;
  if (depsDiffer(oldPkg.dependencies, newPkg.dependencies)) {
    try {
      step(emit, 'deps', '依赖有变化，正在安装（可能需要一两分钟）…');
      depsInstalled = runNpmInstall();
    } catch (e) {
      // 程序文件已更新到位，依赖装不上不该回滚；如实报告让用户手动跑 npm install
      depsWarning = e.message;
    }
  }

  // 临时包体积大，成功与否都清掉
  try { fs.rmSync(work, { recursive: true, force: true }); } catch { /* 清理失败不影响结果 */ }

  step(emit, 'copied', '程序文件已更新');
  return {
    previous: remote.current.version,
    version: remote.latest,
    backup,
    copied,
    depsInstalled,
    depsWarning,
    restartRequired: true,
  };
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

function runNpmInstall() {
  const r = spawnSync('npm', ['install', '--no-audit', '--no-fund'], {
    cwd: ROOT,
    encoding: 'utf8',
    shell: true,
    timeout: 300000,
    maxBuffer: 16 * 1024 * 1024,
  });
  if (r.error) throw new Error('依赖安装失败：' + r.error.message);
  if (r.status !== 0) {
    throw new Error('依赖安装失败，请在项目目录手动执行 npm install：'
      + String(r.stderr || r.stdout || '').trim().slice(-300));
  }
  return true;
}

// ============ 路由 ============

function register({ get, post }) {
  get('/api/version', (req, res) => {
    sendJson(res, 200, Object.assign({ ok: true }, version.info()));
  });

  get('/api/update/check', async (req, res) => {
    try {
      sendJson(res, 200, Object.assign({ ok: true }, await checkNow()));
    } catch (e) {
      sendJson(res, 200, { ok: false, error: (e && e.message) || String(e) });
    }
  });

  // 一键更新走 SSE：下载 + 解压 + 依赖安装可能耗时几分钟，前端需要看到进度
  post('/api/update/apply', async (req, res) => {
    const emit = sse(res);
    try {
      const r = await applyUpdate(emit);
      emit(Object.assign({
        phase: 'done',
        ok: true,
        message: `已更新到 v${r.version}：请关闭本窗口后重新双击 启动.bat 生效`,
      }, r));
    } catch (e) {
      emit({ phase: 'error', ok: false, message: (e && e.message) || String(e) });
    } finally {
      try { res.end(); } catch { /* 客户端已断开 */ }
    }
  });
}

/**
 * 启动后自动检查更新。**只由 main.js 在真正监听端口后调用** ——
 * 被 require（单元测试）时不产生任何定时器，避免测试进程悬挂。
 */
function startAutoCheck() {
  const cfg = loadConfig();
  if (!cfg.enabled || !cfg.configured) {
    console.log('  - 版本更新：未配置清单地址（server/config/update.json 的 manifestUrl），已跳过检查');
    return;
  }
  const interval = Math.max(1, cfg.intervalHours) * 3600 * 1000;
  const run = async (tag) => {
    const r = await checkNow();
    const cur = r.current.version;
    if (r.error) console.log(`[更新检查/${tag}] 失败：${r.error}`);
    else if (r.hasUpdate) console.log(`[更新检查/${tag}] 发现新版本 v${r.latest}（当前 v${cur}），可在门户页左侧底部一键更新`);
    else console.log(`[更新检查/${tag}] 已是最新（v${cur}）`);
  };
  const first = setTimeout(() => run('启动').catch(() => {}), 5000);
  const timer = setInterval(() => run('定时').catch(() => {}), interval);
  first.unref();
  timer.unref();
}

module.exports = { register, startAutoCheck, checkNow, applyUpdate, loadConfig, COPY_ITEMS };
