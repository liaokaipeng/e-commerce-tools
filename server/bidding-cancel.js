/**
 * Shopee 取消竞价模块（CommonJS）
 * 由合并服务 main.js 引入，通过 register({ get, post }) 注册路由（本文件只注册路由）。
 * 与竞价导出共用同一份登录 Cookie（server/data/bidding-session.json，扩展推送保存）。
 *
 * 人工流程还原（接口还原，不用 UI 自动化）：
 *   列表页「进行中的竞价」→「待改进」Tab 即 get_item_ongoing_list 的 page_tab=2，
 *   其中每个 model 都是一条待改进竞价（bid_status=40 / 价格缺乏竞争力），
 *   逐个点击「撤销」即 seller_withdraw { bid_id }。
 *
 * 链路拆分到 bidding-cancel/ 子模块：
 *   constants.js  常量（提交间隔 / 待改进 page_tab）
 *   parse.js      纯解析（待改进竞价行提取）
 *   api.js        接口调用（列表 / 撤销）
 *   preview.js    预览编排（JSON）
 *   job.js        执行编排（SSE + 暂停/继续/取消）
 */
const { readJsonBodySoft } = require('./lib/http-utils');
// 长任务注册中心：暂停 / 继续 / 取消 / SSE 断开即取消 / 僵尸清理
const jobs = require('./lib/jobs');
const { toAmount } = require('./lib/shopee-session');
const { extractImprovementItems } = require('./bidding-cancel/parse');
const { fetchImprovementBids, withdrawBid } = require('./bidding-cancel/api');
const { handlePreview } = require('./bidding-cancel/preview');
const { handleRun } = require('./bidding-cancel/job');

// ============ 路由注册 ============
function register({ post }) {
  post('/api/bidding-cancel/preview', async (req, res) => {
    const parsed = await readJsonBodySoft(req, '/api/bidding-cancel/preview');
    handlePreview(parsed, res);
  });

  post('/api/bidding-cancel/run', async (req, res) => {
    const parsed = await readJsonBodySoft(req, '/api/bidding-cancel/run');
    handleRun(parsed, res);
  });

  // 暂停 / 继续 / 取消执行中的任务（body { jobId }，jobId 由 run 的 start 事件下发）
  // 三个路由的样板与 404 语义统一由 lib/jobs.registerControlRoutes 提供
  jobs.registerControlRoutes(post, '/api/bidding-cancel');
}

module.exports = { register, fetchImprovementBids, withdrawBid, extractImprovementItems, toAmount };
