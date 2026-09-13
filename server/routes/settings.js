'use strict';
// 工具默认目录设置路由：settings.json 持久化（不入库）。
// GET  /api/settings            读取各工具默认目录
// POST /api/settings            设置某工具默认目录 { tool, dir }
const { sendJson, readJsonBodySoft } = require('../lib/http-utils');
const settings = require('../lib/settings');

function register({ get, post }) {
  get('/api/settings', (req, res) => {
    sendJson(res, 200, {
      ok: true,
      defaults: {
        tiktok: settings.getDefault('tiktok'),
        bidding: settings.getDefault('bidding'),
      },
    });
  });

  post('/api/settings', async (req, res) => {
    try {
      const { tool, dir } = await readJsonBodySoft(req, '/api/settings');
      if (tool !== 'tiktok' && tool !== 'bidding') {
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
