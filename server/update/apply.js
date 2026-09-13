'use strict';
/**
 * 一键更新编排（SSE 进度）：下载 → 校验 sha256 → 解压 → 备份数据 → 白名单覆盖 → 依赖差异安装。
 *
 * 覆盖前先把 server/data 整目录备份到 backup/data-<时间戳>；
 * 程序文件落盘后**必须重启服务才生效**（后端模块已加载进内存），结果如实返回 restartRequired。
 */
const fs = require('fs');
const path = require('path');

const { readJson } = require('../lib/json-file');
const { pad2 } = require('../lib/date-utils');

const { ROOT, WORK_ROOT, loadConfig } = require('./config');
const { checkNow } = require('./manifest');
const { probeTar, extractZip, resolvePkgRoot, assertLooksLikePackage } = require('./archive');
const { downloadTo } = require('./download');
const { backupData, copyWhitelist } = require('./whitelist');
const { depsDiffer, runNpmInstall } = require('./deps');

function stamp() {
  const d = new Date();
  return `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}-${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}`;
}

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
  const oldPkg = readJson(path.join(ROOT, 'package.json')) || {};
  const newPkg = readJson(path.join(pkgRoot, 'package.json')) || {};
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

module.exports = { applyUpdate };
