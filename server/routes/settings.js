'use strict';
// 工具默认目录设置路由：settings.json 持久化（不入库）。
// GET  /api/settings            读取各工具默认目录
// POST /api/settings            设置某工具默认目录 { tool, dir }
// 视频压缩页不记住文件夹（输出与源文件同目录），故 compress 不在允许列表内。
const { sendJson, readJsonBodySoft } = require('../lib/http-utils');
const settings = require('../lib/settings');

/** 允许写入的工具标识 */
const TOOLS = ['tiktok', 'bidding'];

function register({ get, post }) {
  get('/api/settings', (req, res) => {
    const defaults = {};
    for (const t of TOOLS) defaults[t] = settings.getDefault(t);
    sendJson(res, 200, { ok: true, defaults });
  });

  post('/api/settings', async (req, res) => {
    try {
      const { tool, dir } = await readJsonBodySoft(req, '/api/settings');
      if (!TOOLS.includes(tool)) {
        sendJson(res, 400, { ok: false, message: '无效的工具' });
        return;
      }
      const d = String(dir || '').trim();
      if (!d) {
        sendJson(res, 400, { ok: false, message: '目录不能为空' });
        return;
      }
      settings.setDefault(tool, d);
      sendJson(res, 200, { ok: true, dir: d });
    } catch (e) {
      sendJson(res, 400, { ok: false, message: e.message });
    }
  });
}

module.exports = { register };
