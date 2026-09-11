/**
 * 统一重试 / 退避工具（CommonJS）
 *
 * 原先各链路各写一份重试循环，退避口径互不一致：
 *   - video/request.js   指数退避 1s/2s/4s…，上限 8s（5xx 与网络错误都重试）
 *   - openapi/client.js  固定 1s，最多重试 1 次（业务错误不重试）
 *   - tiktok/parse.js    线性递增 3s/6s/9s + 随机抖动，最多 5 次（防风控）
 *   - product-export.js  纯立即重试 2 次，无退避
 * 现收敛到本文件：重试语义（哪些错误可重试、退避多久）由调用方按场景选择，
 * 循环骨架与本文件统一，新增链路不再各写一份。
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 指数退避：1s / 2s / 4s… 上限 maxMs（适合网络抖动、5xx） */
function exponentialBackoff(baseMs = 1000, maxMs = 8000) {
  return (attempt) => Math.min(baseMs * Math.pow(2, attempt - 1), maxMs);
}

/** 固定间隔（适合上游限流窗口固定的场景，如开放平台网关） */
function fixedBackoff(ms = 1000) {
  return () => ms;
}

/**
 * 线性递增 + 随机抖动（适合需要「看起来不像机器人」的场景，如 TikTok 页面抓取）。
 * @param {number} stepMs 每次递增的基数（第 n 次等待 ≈ stepMs * n）
 * @param {number} jitterMs 附加随机抖动上限
 */
function jitteredLinearBackoff(stepMs = 3000, jitterMs = 2000) {
  return (attempt) => stepMs * attempt + Math.floor(Math.random() * jitterMs);
}

/**
 * 通用重试：按 waitOf(attempt) 退避，直到成功或次数耗尽。
 * @param {() => Promise<any>} fn 每次尝试执行的动作（抛错即视为失败）
 * @param {object} [o]
 *   - attempts {number} 总尝试次数（默认 3，即最多重试 2 次）
 *   - waitOf {(attempt: number) => number} 第 attempt 次失败后的等待毫秒数（默认指数退避）
 *   - shouldRetry {(e: Error, attempt: number) => boolean} 该错误是否重试（默认「未达次数即重试」）
 *   - onRetry {(e: Error, attempt: number, waitMs: number) => void} 重试前回调（打日志 / 上报进度）
 *   - isAborted {() => boolean} 返回 true 时立即停止重试并抛出最后的错误（任务取消用）
 * @returns {Promise<any>} fn 的返回值
 */
async function retry(fn, { attempts = 3, waitOf = exponentialBackoff(), shouldRetry, onRetry, isAborted } = {}) {
  let lastErr;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn(attempt);
    } catch (e) {
      lastErr = e;
      // 任务取消等中断：不重试，直接把原因抛给上层（避免被误判为「行失败」）
      if (isAborted && isAborted()) throw e;
      if (attempt >= attempts) break;
      if (shouldRetry && !shouldRetry(e, attempt)) break;
      const waitMs = waitOf(attempt);
      if (onRetry) onRetry(e, attempt, waitMs);
      if (waitMs > 0) await sleep(waitMs);
    }
  }
  throw lastErr;
}

module.exports = { sleep, retry, exponentialBackoff, fixedBackoff, jitteredLinearBackoff };
