/**
 * Shopee 实时竞价数据导出模块（CommonJS）
 * 由合并服务 main.js 引入，通过 register({ get, post }) 注册路由（本文件只注册路由）。
 * 登录 Cookie 由浏览器扩展推送至 /api/cookie，保存到 server/data/bidding-session.json。
 *
 * 链路拆分到 bidding/ 子模块：
 *   constants.js  常量（翻页 / 获胜 page_tab）
 *   api.js        接口调用（抓取获胜竞价）
 *   excel.js      Excel 落盘
 *   export.js     导出编排（单店 + SSE 批量）
 *   cookie.js     扩展 Cookie 接收与登录状态
 */
const { sendJson, readJsonBodySoft } = require('./lib/http-utils');
const { toAmount } = require('./lib/shopee-session');
const { sessionStatus, handleCookie } = require('./bidding/cookie');
const { handleExport } = require('./bidding/export');

// ============ 路由注册 ============
function register({ get, post }) {
  get('/api/status', (req, res) => {
    sendJson(res, 200, sessionStatus());
  });

  post('/api/export', async (req, res) => {
    const parsed = await readJsonBodySoft(req, '/api/export');
    handleExport(parsed, res);
  });

  post('/api/cookie', (req, res) => {
    handleCookie(req, res);
  });
}

module.exports = { register, toAmount };
