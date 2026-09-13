'use strict';
// 采集队列与并发闸门：同店串行（同店不并发避免触发限频），跨店并发 ≤ MAX_SHOP_CONCURRENCY。
const { MAX_SHOP_CONCURRENCY } = require('./config');
const { state } = require('./state');
const { runJob } = require('./runner');

/** 入队（同店串行；已在执行或已排队则跳过；未启用监控的店铺不入队） */
function enqueue(shopId, domain) {
  const key = shopId + ':' + domain;
  if (state.inFlight.has(key)) return false;
  const shop = state.shops.find((s) => s.shopId === shopId);
  if (!shop || !shop.monitored) return false;
  state.inFlight.add(key);
  const prev = state.queue.get(shopId) || Promise.resolve();
  const task = prev.then(async () => {
    // 跨店并发闸门：等待名额再执行
    while (state.active >= MAX_SHOP_CONCURRENCY) await new Promise((r) => setTimeout(r, 500));
    state.active += 1;
    try {
      await runJob(shopId, domain);
    } catch (e) {
      console.warn('[监控] 任务执行异常:', e.message);
    }
  }).catch(() => { /* runJob 已兜底，双保险 */ });
  state.queue.set(shopId, task);
  return true;
}

module.exports = { enqueue };
