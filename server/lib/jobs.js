/**
 * 长任务注册中心（CommonJS）
 *
 * 供「批量操作类任务」共用（取消注册 Hot Listing、取消竞价、视频上传等）：
 * 统一承担 暂停 / 继续 / 取消 / SSE 客户端断开即取消 / 僵尸任务清理，
 * 避免各模块各写一份 jobs Map 与 waitIfPaused 循环（行为容易漂移）。
 *
 * 生命周期：create 建任务 → 执行体在关键步骤间 await checkpoint()（被暂停则挂起、
 * 被取消则抛 CancelledError）→ 执行体结束时 finish 收尾。
 * 除显式取消外，「SSE 客户端断开」也视为取消：本地单人工具里用户关掉页面即代表不想继续。
 */
const TTL_MS = 30 * 60 * 1000;   // 任务最长存活时间（防执行体异常后残留）
const SWEEP_MS = 60 * 1000;      // 僵尸任务巡检间隔

/** 任务被取消时由 checkpoint 抛出，执行体可据此提前收尾 */
class CancelledError extends Error {
  constructor(msg = '任务已取消') {
    super(msg);
    this.name = 'CancelledError';
  }
}

/** jobId -> { paused, cancelled, createdAt, onCancel } */
const jobs = new Map();
let sweepTimer = null;

function ensureSweeper() {
  if (sweepTimer) return;
  sweepTimer = setInterval(() => sweepJobs(), SWEEP_MS);
  // 巡检定时器不阻止进程退出
  if (sweepTimer.unref) sweepTimer.unref();
}

/**
 * 巡检一次：回收超过 TTL 的任务（执行体异常退出时不会调用 finish，靠这里兜底）。
 * 回收前先标记 cancelled 并触发 onCancel 钩子，避免执行体仍在运行时无法感知中断。
 * @param {number} [now]
 * @returns {number} 本次回收的任务数
 */
function sweepJobs(now = Date.now()) {
  let swept = 0;
  for (const [id, job] of jobs) {
    if (now - job.createdAt > TTL_MS) {
      job.cancelled = true;
      job.cancelReason = job.cancelReason || '任务超时';
      try { if (job.onCancel) job.onCancel(job.cancelReason); } catch { /* 钩子异常不影响回收 */ }
      jobs.delete(id);
      swept += 1;
    }
  }
  return swept;
}

/**
 * 创建任务。
 * @param {(reason?: string) => void} [onCancel] 取消时的附加处理（如中断进行中的请求）
 * @returns {string} jobId（下发给前端，前端据此发暂停/继续/取消）
 */
function create(onCancel = null) {
  ensureSweeper();
  const jobId = 'job_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
  jobs.set(jobId, { paused: false, cancelled: false, createdAt: Date.now(), onCancel });
  return jobId;
}

function get(jobId) {
  return jobs.get(String(jobId || ''));
}

/** 是否存在该任务（发取消指令前判断「任务不存在或已结束」用） */
function has(jobId) {
  return jobs.has(String(jobId || ''));
}

/** @returns {boolean} 任务是否存在 */
function setPaused(jobId, paused) {
  const job = jobs.get(String(jobId || ''));
  if (!job) return false;
  job.paused = !!paused;
  return true;
}

/**
 * 请求取消：标记取消并调用 onCancel 钩子（中断进行中的请求）。
 * 执行体在下一个 checkpoint 处退出；本次进行中的单条请求由钩子负责中断。
 * @returns {boolean} 任务是否存在
 */
function cancel(jobId, reason = '用户取消') {
  const job = jobs.get(String(jobId || ''));
  if (!job) return false;
  job.cancelled = true;
  job.cancelReason = reason;
  try { if (job.onCancel) job.onCancel(reason); } catch { /* 钩子异常不影响取消 */ }
  return true;
}

/** 取消后供执行体查询的取消原因（如「任务取消」「SSE 连接断开」） */
function cancelReason(jobId) {
  const job = jobs.get(String(jobId || ''));
  return (job && job.cancelReason) || '任务已取消';
}

/**
 * 执行体在关键步骤间调用的门控点：
 * - 任务被取消（显式取消 / SSE 断开 / TTL 过期）→ 抛 CancelledError；
 * - 任务被暂停 → 轮询挂起，直到继续或取消。
 * @param {() => boolean} [isAborted] 可选的额外中断条件（如 SSE 连接已断开且未来得及取消）
 */
async function checkpoint(jobId, isAborted) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  for (;;) {
    const job = jobs.get(String(jobId || ''));
    if (!job) throw new CancelledError('任务已结束');
    if (job.cancelled) throw new CancelledError(job.cancelReason || '任务已取消');
    if (isAborted && isAborted()) throw new CancelledError('SSE 连接已断开');
    if (!job.paused) return true;
    await sleep(200);
  }
}

/** 收尾：从注册表移除（可重复调用） */
function finish(jobId) {
  jobs.delete(String(jobId || ''));
}

/** 当前任务数（测试与诊断用） */
function size() {
  return jobs.size;
}

module.exports = {
  create, get, has, setPaused, cancel, cancelReason, checkpoint, finish, size, CancelledError,
  _ttlMs: TTL_MS,
  _test: { sweepJobs },
};
