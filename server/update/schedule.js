'use strict';
/**
 * 启动后自动检查更新。**只由 main.js 在真正监听端口后调用** ——
 * 被 require（单元测试）时不产生任何定时器，避免测试进程悬挂。
 */
const { loadConfig } = require('./config');
const { checkNow } = require('./manifest');

function startAutoCheck() {
  const cfg = loadConfig();
  if (!cfg.enabled || !cfg.configured) {
    console.log('  - 版本更新：未配置清单地址（server/config/update.json 的 manifestUrl），已跳过检查');
    return;
  }
  const interval = Math.max(1, cfg.intervalHours) * 3600 * 1000;
  const run = async (tag) => {
    const r = await checkNow();
    const cur = r.current.version;
    if (r.error) console.log(`[更新检查/${tag}] 失败：${r.error}`);
    else if (r.hasUpdate) console.log(`[更新检查/${tag}] 发现新版本 v${r.latest}（当前 v${cur}），可在门户页左侧底部一键更新`);
    else console.log(`[更新检查/${tag}] 已是最新（v${cur}）`);
  };
  const first = setTimeout(() => run('启动').catch(() => {}), 5000);
  const timer = setInterval(() => run('定时').catch(() => {}), interval);
  first.unref();
  timer.unref();
}

module.exports = { startAutoCheck };
