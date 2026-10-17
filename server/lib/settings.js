// 工具默认目录持久化（settings.json，不入库）
// 供 TikTok 下载 / 竞价导出共用：首次让用户自选目录，确认后设为默认，下次打开自动回显。
const path = require('path');
const { readJson, writeJson } = require('./json-file');

const FILE = path.join(__dirname, '..', 'data', 'settings.json');

function load() {
  // 文件不存在属正常（首次使用）；损坏才告警——否则用户看到的是「从未设置」而非「配置文件损坏」
  return readJson(FILE, {}, (e) => {
    if (e.code !== 'ENOENT') console.warn('读取默认目录设置失败（按未设置处理）:', e.message);
  });
}

function save(data) {
  try {
    writeJson(FILE, data);
  } catch (e) {
    // 写盘失败不能静默：默认目录设置会丢失，用户需要知道原因（通常是权限或磁盘问题）
    console.warn(`保存默认目录设置失败(${FILE}):`, e && e.message ? e.message : e);
    throw new Error('保存默认目录设置失败：' + (e && e.message ? e.message : e));
  }
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

module.exports = { getDefault, setDefault };