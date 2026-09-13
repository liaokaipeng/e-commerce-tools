'use strict';
// 单元测试入口：按主题拆分到 test/unit/ 子模块，逐个串行执行。
// 覆盖：视频上传工具（video-utils/出站/取消）、TikTok、竞价系（导出/取消/取消注册）、开放平台、
//      共享层（出站/长任务/重试/导出/路由分发/CORS）、监控（纯函数/引擎/存储）。
//
// 重要：监控数据目录必须先隔离到临时目录再 require 监控模块。
// 否则 store 会读取 server/data/monitor/rules.json 里用户真实保存的规则覆盖，
// 金额/阈值类断言会随用户配置漂移（曾出现 ads.spend_today 被覆盖为 1000/3000/6000
// 导致「500 泰铢触发 P2」断言失败）。与 test/api.test.js 的 MONITOR_DATA_DIR 隔离口径一致。
const os = require('os');
const path = require('path');
const UNIT_MONITOR_TMP = path.join(os.tmpdir(), `kp_unit_monitor_${process.pid}_${Date.now()}`);
process.env.MONITOR_DATA_DIR = UNIT_MONITOR_TMP;

// 子模块顺序即执行顺序：monitor 纯函数（含汇率钉死 lockStaticRatesForTest）
// 必须先于 monitor-engine（其金额阈值断言依赖已钉死的汇率）。
const modules = [
  require('./unit/video.test'),
  require('./unit/tiktok.test'),
  require('./unit/bidding-cancel.test'),
  require('./unit/openapi.test'),
  require('./unit/shared-layer.test'),
  require('./unit/http.test'),
  require('./unit/monitor.test'),
  require('./unit/monitor-engine.test'),
];

async function run() {
  for (const m of modules) {
    await m.run();
  }
}

module.exports = { run };
