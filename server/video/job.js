'use strict';
// Job / SSE 管理：任务事件广播、迟到连接回放、取消与收尾。

const clients = new Map(); // jobId -> Set(res)
// jobId -> [event, ...]：任务已产生的事件，供“迟到连接”回放。
// 任务可能在 SSE 连接建立前就结束（如首行校验秒失败），没有回放会让前端一直卡在“上传中”。
const jobEvents = new Map();
const JOB_EVENT_CAP = 20; // 本地工具场景，最多缓存最近 20 个任务的事件
const JOB_EVENT_MAX = 200; // 单个任务最多保留 200 条事件

// 任务取消：jobControllers（jobId -> AbortController，中断进行中的请求）+ abortedJobs（取消标志）
const jobControllers = new Map();
const abortedJobs = new Set();

function keepJobEvents(jobId, data) {
  if (!jobEvents.has(jobId)) jobEvents.set(jobId, []);
  const arr = jobEvents.get(jobId);
  arr.push(data);
  if (arr.length > JOB_EVENT_MAX) arr.splice(0, arr.length - JOB_EVENT_MAX);
  if (jobEvents.size > JOB_EVENT_CAP) {
    const first = jobEvents.keys().next().value;
    jobEvents.delete(first);
  }
}

function broadcast(jobId, data) {
  keepJobEvents(jobId, data);
  const set = clients.get(jobId);
  if (!set) return;
  const payload = `data: ${JSON.stringify(data)}\n\n`;
  for (const res of set) {
    // 连接可能已关闭，避免 write 抛错被误记为上传失败
    try { if (!res.writableEnded) res.write(payload); } catch (e) { /* 忽略写错误 */ }
  }
}

// 任务收尾：中断请求、清取消标志、断开 SSE 连接。
// 收尾前事件已由 processJob 广播完毕，这里主动 end 掉连接，避免前端未自己 close 时连接悬挂；
// 迟到连接的回放由 video.js 的 /api/events 按终态事件直接关闭。
function finishJob(jobId) {
  const c = jobControllers.get(jobId);
  if (c) { try { c.abort(); } catch (e) { /* ignore */ } jobControllers.delete(jobId); }
  abortedJobs.delete(jobId);
  const set = clients.get(jobId);
  if (set) {
    for (const res of set) {
      try { if (!res.writableEnded) res.end(); } catch (e) { /* 忽略写错误 */ }
    }
    clients.delete(jobId);
  }
}

async function processJob(jobId, rows, creds, uploadOne) {
  const total = rows.length;
  let done = 0;
  for (let i = 0; i < total; i++) {
    if (abortedJobs.has(jobId)) {
      broadcast(jobId, { type: 'cancelled', total, done });
      finishJob(jobId);
      return;
    }
    const row = rows[i];
    broadcast(jobId, { type: 'row-start', index: i, total, row });
    try {
      const signal = (jobControllers.get(jobId) || { signal: undefined }).signal;
      const result = await uploadOne(row, creds, (step, msg) =>
        broadcast(jobId, { type: 'step', index: i, step, msg })
      , signal);
      done++;
      broadcast(jobId, { type: 'row-done', index: i, result });
    } catch (e) {
      // 取消触发的中断（如正在上传的请求被 abort）不当作行失败上报
      if (abortedJobs.has(jobId)) {
        broadcast(jobId, { type: 'cancelled', total, done });
        finishJob(jobId);
        return;
      }
      done++;
      // e.skip=true 表示「跳过该行不上传」（如商品编码为空/找不到商品），前端据此把状态列标成「失败，商品为空」
      broadcast(jobId, { type: 'row-error', index: i, error: e.message, skip: e.skip === true });
    }
  }
  broadcast(jobId, { type: 'finished', total, done });
  finishJob(jobId);
}

module.exports = {
  clients,
  jobEvents,
  jobControllers,
  abortedJobs,
  keepJobEvents,
  broadcast,
  finishJob,
  processJob,
};
