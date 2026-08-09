// 工具默认目录持久化（settings.json，不入库）
// 供 TikTok 下载 / 竞价导出共用：首次让用户自选目录，确认后设为默认，下次打开自动回显。
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'settings.json');

function load() {
  try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); }
  catch { return {}; }
}

function save(data) {
  try { fs.writeFileSync(FILE, JSON.stringify(data, null, 2)); } catch {}
}

/** 读取某工具的默认目录（未设置返回 null） */
function getDefault(tool) {
  const d = load()[tool];
  return d && d.dir ? d.dir : null;
}

/** 设置某工具的默认目录 */
function setDefault(tool, dir) {
  const data = load();
  data[tool] = { dir: String(dir).trim() };
  save(data);
}

module.exports = { getDefault, setDefault, FILE };