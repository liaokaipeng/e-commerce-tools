/**
 * Shopee 获取退单仓库模块（CommonJS）
 * 由合并服务 main.js 引入，通过 register({ get, post }) 注册路由（本文件只注册路由）。
 *
 * 功能：批量把 Return ID 转成退货仓库 ID（whs_id）。表格解析与导出在前端完成
 * （SheetJS，与 video 页一致），后端只接收解析后的行并逐行调官方接口。
 * 支持多店铺混合表：shopId 逐行携带（表格「店铺id」列驱动；也可不选店铺），
 * 前端只在恰好选中 1 个店铺时给没有店铺id 的行兜底，后端不再要求全局单选店铺。
 *
 * 接口还原（开放平台，非 UI 自动化；2026-10 实测）：
 *   GET /api/v2/returns/get_return_detail?return_sn=<Return ID>
 *     → response.return_address.whs_id 即退货仓库 ID（如 PHBUL4）
 *   注意：response.return_pickup_address（买家取货地址）全量打码不可用；
 *         v2.returns.get_return_list 响应不含 whs_id 且不支持按 order_sn 过滤，
 *         所以只能逐单查 detail（表格需带 Return ID 列）。
 * 调用统一走 lib/openapi/client 的 callOpenApi（自动签名 / 带 token / 刷新），
 * 查询类接口必须显式 method: 'GET'。
 *
 * 链路拆分到 return-whs/ 子模块：
 *   parse.js    纯解析（Return ID 归一化 / whs_id 提取 / 分块）
 *   job.js      执行编排（SSE + 暂停/继续/取消）
 */
'use strict';
const { readJsonBodySoft } = require('./lib/http-utils');
// 长任务注册中心（暂停 / 继续 / 取消 / SSE 断开即取消 / TTL 清理）：与其它批量工具共用
const jobs = require('./lib/jobs');
const { handleRun } = require('./return-whs/job');
const { normalizeReturnId, normalizeShopId, extractWhsId, splitChunks } = require('./return-whs/parse');

// ============ 路由注册 ============
function register({ get, post }) {
  post('/api/return-whs/run', async (req, res) => {
    const parsed = await readJsonBodySoft(req, '/api/return-whs/run');
    handleRun(parsed, res);
  });

  // 暂停 / 继续 / 取消执行中的任务（body { jobId }，jobId 由 run 的 start 事件下发）
  // 三个路由的样板与 404 语义统一由 lib/jobs.registerControlRoutes 提供
  jobs.registerControlRoutes(post, '/api/return-whs');
}

module.exports = { register, normalizeReturnId, normalizeShopId, extractWhsId, splitChunks };
