'use strict';
/**
 * 依赖差异与安装：更新包落地后，若 dependencies 有变化则执行 npm install。
 */
const { spawnSync } = require('child_process');

const { ROOT } = require('./config');

function depsDiffer(a = {}, b = {}) {
  const norm = (o) => JSON.stringify(Object.keys(o).sort().map((k) => [k, o[k]]));
  return norm(a) !== norm(b);
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

module.exports = { depsDiffer, runNpmInstall };
