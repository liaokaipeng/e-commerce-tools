'use strict';
/**
 * 开放平台「批量刷新 token」门面（CommonJS）
 *
 * 与「开放平台」页单个「刷新 token」按钮共用同一条刷新入口（client/ensure.refreshShopNow），
 * 本模块只负责「把全部店铺逐个刷一遍」。
 *
 * 为什么逐店刷新：官方 refresh_access_token 要求 shop_id / merchant_id「必须分别刷新」，且按 shop_id
 * 刷新得到的 token 只绑定该店（实测 merchant_id 刷出来的是商户级 token，调店铺级接口报 invalid_acceess_token）。
 * 因此批量刷新 = 逐店调用 refreshShopNow，每个店铺各自换 token、各自保存（见 docs/开放平台链路.md §3）。
 *
 * 刷不了的店铺（已失效 / 缺 refresh_token）直接跳过并说明原因，不发网关请求、不额外标失效：
 * 用户主动点批量刷新不该把「其实还好的店铺」标死，跳过原因交给前端展示。
 *
 * 另有两道防护（见 openapi 链路文档 §3）：
 * - 单飞互斥（runningJobId）：同一时刻只允许一个批量任务，进行中再触发回 409；
 * - 冷却：refreshShopNow 自带冷却，刚刷过的店铺直接复用当前 token（mode='cooldown'），不重复触网。
 *
 * 实现按职责拆分到 refresh-all/ 子模块，本文件只做导出聚合：
 *   refresh-all/plan.js   planRefreshGroups：批量刷新计划（纯函数，一店一单元）
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
