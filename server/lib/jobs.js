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
const { sendJson, readRouteBody, sse } = require('./http-utils');

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

/**
 * 注册「暂停 / 继续 / 取消」三个控制路由（body { jobId }，jobId 由 run 的 start 事件下发）。
 * 供各批量任务模块在 register({ post }) 内一行接入，避免复制同一段样板
 * （取消竞价 / 取消 Hot Listing / 视频上传等）。
 *
 * 语义：请求体非法 → readRouteBody 回 400；任务不存在或已结束 → 404。
 * @param {(p: string, fn: Function) => void} post 路由注册函数（main.js 注入）
 * @param {string} basePath 接口前缀，如 '/api/bidding-cancel'（内部拼 /pause /resume /cancel）
 * @param {object} [deps] { sendJson, readRouteBody } 依赖注入（默认取 lib/http-utils）
 */
function registerControlRoutes(post, basePath, deps) {
  const { sendJson: sj, readRouteBody: rrb } = deps || { sendJson, readRouteBody };
  const notFound = { ok: false, msg: '任务不存在或已结束' };
  const reply = (res, ok) => sj(res, ok ? 200 : 404, ok ? { ok: true } : notFound);

  post(`${basePath}/pause`, async (req, res) => {
    const parsed = await rrb(req, `${basePath}/pause`, { res });
    if (!parsed) return;
    reply(res, setPaused(parsed.jobId, true));
  });

  post(`${basePath}/resume`, async (req, res) => {
    const parsed = await rrb(req, `${basePath}/resume`, { res });
    if (!parsed) return;
    reply(res, setPaused(parsed.jobId, false));
  });

  post(`${basePath}/cancel`, async (req, res) => {
    const parsed = await rrb(req, `${basePath}/cancel`, { res });
    if (!parsed) return;
    reply(res, cancel(parsed.jobId, '用户取消'));
  });
}

/**
 * SSE 响应安全收尾：客户端可能已断开，res.end() 会抛错，统一吞掉。
 * 供各流式接口在任务结束时收尾（避免各处复制 try { res.end() } catch {}）。
 */
function safeEnd(res) {
  try { if (!res.writableEnded) res.end(); } catch { /* 连接已断开，忽略 */ }
}

/**
 * 批量任务执行骨架（SSE）：把「校验通过之后」的批量执行收敛到一处，供
 * 取消竞价 / 取消 Hot Listing / 批量刷新 token 复用，避免三处各写一份近乎同构的
 * 「SSE 建立 + 客户端断开即取消 + 逐单元 checkpoint + CancelledError 归并 + 收尾」骨架。
 *
 * 对所有调用方一致的职责：
 *   1. 建立 SSE 响应并监听客户端断开（断开即视为取消）；
 *   2. 建任务并下发首事件 start（带 jobId，前端据此发暂停 / 继续 / 取消）；
 *   3. 逐单元 checkpoint（暂停挂起 / 取消抛 CancelledError），把 CancelledError 归并为
 *      cancelledByUser，已处理部分照常汇总，不再继续后续单元；
 *   4. 收尾：先释放（release，默认 finish）再下发收尾事件（cancelled 或 summary），结束响应；
 *   5. 执行体异常兜底为 fatal（文案前缀由调用方给出）。
 *
 * 调用方只注入差异：prepare（执行前准备，如加载凭证）、units（按店 / 按组）、
 * startPayload（start 事件附加字段）、beforeLoop（循环前动作，如下发 skipped）、
 * onUnit（单单元执行体，自行 emit 单元事件并记录结果）、finalEvent（收尾事件）、
 * fatalPrefix（兜底文案前缀）、onCreate / release（建任务回调与收尾释放，如单飞互斥）。
 *
 * @param {object} opts
 * @param {object} opts.res http.ServerResponse（SSE）
 * @param {() => (object|Promise<object>)} [opts.prepare] 执行前准备；抛错则释放 + fatal(e.message) + 结束返回（不下发 jobId）
 * @param {Array} opts.units 单元列表（店铺 / 分组）
 * @param {object} [opts.startPayload] 追加到 start 事件的字段（jobId 由执行器下发）
 * @param {(ctx: object) => (void|Promise<void>)} [opts.beforeLoop] 循环前动作（如下发 skipped 事件）
 * @param {(unit: any, ctx: object) => Promise<void>} opts.onUnit 单元执行体（自行 emit 单元事件并记录结果）
 * @param {(state: {cancelledByUser: boolean, ctx: object}) => object} opts.finalEvent 收尾事件（cancelled 或 summary）
 * @param {string} [opts.fatalPrefix] 兜底 fatal 文案前缀
 * @param {(jobId: string) => void} [opts.onCreate] 建任务后立即回调（如登记单飞互斥）
 * @param {(jobId: string) => void} [opts.release] 收尾释放（默认 jobs.finish）
 * @returns {string} jobId
 */
function runShopBatch(opts) {
  const {
    res, prepare, units, startPayload, beforeLoop, onUnit, finalEvent,
    fatalPrefix = '', onCreate, release,
  } = opts;
  const emit = sse(res);
  // SSE 客户端断开（用户关掉页面）即视为取消，任务在下个门控点退出
  let clientGone = false;
  if (typeof res.on === 'function') res.on('close', () => { clientGone = true; });
  const jobId = create();
  if (onCreate) onCreate(jobId);
  const done = () => { if (release) release(jobId); else finish(jobId); };

  (async () => {
    let ctx = {};
    if (prepare) {
      try {
        ctx = (await prepare()) || {};
      } catch (e) {
        done();
        emit({ type: 'fatal', msg: e.message });
        res.end();
        return;
      }
    }
    ctx = Object.assign({}, ctx, {
      emit,
      jobId,
      isAborted: () => clientGone,
      checkpoint: () => checkpoint(jobId, () => clientGone),
    });
    // 先下发 jobId，前端据此发暂停 / 继续 / 取消指令
    emit(Object.assign({ type: 'start', jobId }, startPayload || {}));

    let cancelledByUser = false;
    try {
      if (beforeLoop) await beforeLoop(ctx);
      for (const unit of units) {
        await checkpoint(jobId, () => clientGone);
        await onUnit(unit, ctx);
      }
    } catch (e) {
      if (!(e instanceof CancelledError)) throw e;
      cancelledByUser = true;
    }

    done();
    emit(finalEvent({ cancelledByUser, ctx }));
    try { res.end(); } catch { /* ignore */ }
  })().catch((e) => {
    done();
    try { emit({ type: 'fatal', msg: `${fatalPrefix}${e.message}` }); res.end(); } catch { /* ignore */ }
  });

  return jobId;
}

module.exports = {
  create, get, has, setPaused, cancel, cancelReason, checkpoint, finish, size, CancelledError,
  registerControlRoutes, safeEnd, runShopBatch,
  _ttlMs: TTL_MS,
  _test: { sweepJobs },
};
