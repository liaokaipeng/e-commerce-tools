'use strict';
// 工具合集 - 测试入口
// 运行：node test.js（或 npm test）
// 说明：不依赖真实网络（TikTok/Shopee），包含两类测试：
//   1. 单元测试（test/unit.test.js）：纯函数，不启动服务
//   2. 接口冒烟测试（test/api.test.js）：临时端口 8865，验页面与 API 路由，
//      session 凭证文件测试前备份、结束后原样恢复
const { printSummary } = require('./test/helpers');

async function main() {
  console.log('===== 单元测试（纯函数） =====');
  await require('./test/unit.test').run();
  console.log('\n===== 接口冒烟测试 =====');
  await require('./test/api.test').run();
  const ok = printSummary();
  process.exitCode = ok ? 0 : 1;
}

main().catch((e) => {
  console.error('测试执行异常：', e);
  process.exitCode = 1;
});