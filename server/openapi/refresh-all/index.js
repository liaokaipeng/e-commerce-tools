'use strict';
/**
 * 开放平台「批量刷新 token」门面（CommonJS）
 *
 * 与「开放平台」页单个「刷新 token」按钮共用同一条刷新入口（client/ensure.refreshShopNow）与同一套
 * 分组决策（client/plan.planRefresh），本模块只负责「把全部店铺按组编排成一次批量刷新」。
 *
 * 为什么必须按组刷新、不能逐店遍历：
 * 主账号授权得到的是账号级 token 对，同一 merchant 下的店铺共享同一个 refresh_token，而官方语义是
 * 「旧 refresh_token 调用一次即作废」。逐店刷新时，第一店刷完就轮换了 token 对，后续店铺拿旧 token
 * 必然失败，并会把整组店铺标记成「需重新授权」（官方 FAQ138 Q8）。因此批量刷新 = 先按 refreshToken
 * 归组，每组只调一次 refreshShopNow —— 共享组由 planRefresh 走 merchant_id 整组续期，独立凭证只写回本店。
 *
 * 刷不了的组（整组已失效 / 共享 token 缺 merchant_id）直接跳过并说明原因，不发网关请求、不额外标失效：
 * 用户主动点批量刷新不该把「其实还好的店铺」标死，跳过原因交给前端展示。
 *
 * 另有两道防护（见 openapi 链路文档 §3）：
 * - 单飞互斥（runningJobId）：同一时刻只允许一个批量任务，进行中再触发回 409，防并发批量轮换同一批 token；
 * - 冷却：refreshShopNow 自带冷却，刚刷过的组直接复用当前 token（mode='cooldown'），不重复触网。
 *
 * 实现按职责拆分到 refresh-all/ 子模块，本文件只做导出聚合：
 *   refresh-all/plan.js   planRefreshGroups：批量刷新计划（纯函数）
 *   refresh-all/text.js   summaryText：批量刷新汇总文案
 *   refresh-all/run.js    handleRefreshAll：SSE 执行体 + 单飞互斥 + job 门控
 *   refresh-all/route.js  register：路由注册
 */
const { register } = require('./route');
const { planRefreshGroups } = require('./plan');
const { summaryText } = require('./text');

module.exports = {
  register,
  // 纯函数（单测覆盖）
  planRefreshGroups,
  _test: { planRefreshGroups, summaryText },
};
