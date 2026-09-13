'use strict';
// 目录浏览路由（文件夹选择对话框用）：
// GET /api/browse?path=<绝对路径>  列出该目录的子文件夹；path 为空时在 Windows 列出盘符
const fs = require('fs');
const path = require('path');
const { sendJson } = require('../lib/http-utils');

const isWin = process.platform === 'win32';

function listDirs(p) {
  return fs.readdirSync(p, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => ({ name: e.name, path: path.join(p, e.name) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function listDrives() {
  const drives = [];
  for (let i = 65; i <= 90; i++) {
    const letter = String.fromCharCode(i);
    try { fs.statSync(letter + ':\\'); drives.push({ name: letter + ':', path: letter + ':\\' }); }
    catch { /* 该盘符不存在 */ }
  }
  return drives;
}

function register({ get }) {
  get('/api/browse', (req, res, url) => {
    try {
      const p = (url.searchParams.get('path') || '').trim();
      if (!p) {
        sendJson(res, 200, {
          ok: true,
          current: null,
          parent: null,
          dirs: isWin ? listDrives() : listDirs('/'),
        });
        return;
      }
      if (!fs.statSync(p).isDirectory()) {
        sendJson(res, 400, { ok: false, message: '不是目录：' + p });
        return;
      }
      sendJson(res, 200, {
        ok: true,
        current: p,
        parent: path.dirname(p) === p ? null : path.dirname(p),
        dirs: listDirs(p),
      });
    } catch (e) {
      sendJson(res, 400, { ok: false, message: e.message });
    }
  });
}

module.exports = { register };
