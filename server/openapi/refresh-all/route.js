'use strict';
// 批量刷新路由注册：run 触发 SSE 任务，control 路由（暂停/继续/取消）由 jobs 统一注册。
const { readRouteBody } = require('../../lib/http-utils');
const jobs = require('../../lib/jobs');
const { handleRefreshAll } = require('./run');

function register({ post }) {
  // 批量刷新（SSE）：body 可为空对象，店铺范围由服务端按当前环境全部已授权店铺决定
  post('/api/openapi/refresh-all/run', async (req, res) => {
    // 读取（消费）请求体即可：批量范围由服务端决定，body 无业务参数
    await readRouteBody(req, '/api/openapi/refresh-all/run');
    handleRefreshAll(res);
  });

  // 暂停 / 继续 / 取消执行中的批量刷新（body { jobId }，jobId 由 run 的 start 事件下发）
  jobs.registerControlRoutes(post, '/api/openapi/refresh-all');
}

module.exports = { register };
