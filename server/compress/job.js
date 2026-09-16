'use strict';
/**
 * 批量压缩编排（SSE）
 *
 * 复用 lib/jobs.js 的 runShopBatch 骨架：它承担「建任务 + start 事件 + 逐单元 checkpoint +
 * 客户端断开即取消 + CancelledError 归并 + 收尾事件」，本文件只注入压缩特有的差异
 * （单元=文件、单元事件=file-start/file-progress/file-done、单飞互斥）。
 *
 * 单飞互斥：压缩是 CPU 密集任务，同时跑两个任务只会互相拖慢并让进度难以解释，故全局同时只允许一个。
 */
const jobs = require('../lib/jobs');
const { compressOne, AbortedError } = require('./run');

/** 当前运行中的任务 id（null = 空闲），用于单飞互斥与状态展示 */
let activeJobId = null;

function isRunning() {
  return !!activeJobId;
}

/** 任务是否已被要求取消（显式取消会置 cancelled，但不会中断 ffmpeg，靠轮询 kill） */
function isCancelled(jobId) {
  const j = jobs.get(jobId);
  return !!(j && j.cancelled);
}

/**
 * 启动批量压缩（SSE）。
 * @param {object} res http.ServerResponse
 * @param {{ files: Array, root: string, outDir: string, opts: object }} payload
 * @returns {string} jobId
 */
function runBatch(res, payload) {
  const { files, root, outDir, opts } = payload;
  const total = files.length;
  const units = files.map((f, index) => Object.assign({}, f, { index }));

  return jobs.runShopBatch({
    res,
    units,
    startPayload: { total, root, outDir },
    prepare: () => ({ counters: { ok: 0, skip: 0, fail: 0, done: 0, before: 0, after: 0 }, total }),
    onCreate: (jobId) => { activeJobId = jobId; },
    release: (jobId) => {
      jobs.finish(jobId);
      if (activeJobId === jobId) activeJobId = null;
    },
    beforeLoop: (ctx) => {
      ctx.emit({ type: 'files', total, files: units.map((f) => ({ rel: f.rel, name: f.name, size: f.size })) });
    },
    onUnit: async (unit, ctx) => {
      const c = ctx.counters;
      const aborted = () => ctx.isAborted() || isCancelled(ctx.jobId);
      ctx.emit({
        type: 'file-start',
        index: unit.index,
        total,
        rel: unit.rel,
        name: unit.name,
        size: unit.size,
      });
      try {
        const r = await compressOne({
          input: unit.path,
          // 每个文件自带输出目录（保持源目录相对层级），缺省才回落到任务级 outDir
          outDir: unit.outDir || outDir,
          opts,
          shouldAbort: aborted,
          onProbe: (info) => ctx.emit({
            type: 'file-probe',
            index: unit.index,
            duration: info.duration,
            width: info.width,
            height: info.height,
            hasAudio: info.hasAudio,
          }),
          onProgress: (pct) => ctx.emit({ type: 'file-progress', index: unit.index, percent: pct }),
        });
        c.done += 1;
        c.before += r.sizeBefore || 0;
        c.after += r.sizeAfter || r.sizeBefore || 0;
        if (r.skipped) c.skip += 1; else c.ok += 1;
        ctx.emit({
          type: 'file-done',
          index: unit.index,
          skipped: r.skipped,
          reason: r.reason || '',
          outPath: r.outPath,
          sizeBefore: r.sizeBefore,
          sizeAfter: r.sizeAfter,
          durationBefore: r.durationBefore,
          durationAfter: r.durationAfter,
          attempts: r.attempts || 0,
          speedRatio: r.speedRatio || 1,
          withinLimit: r.withinLimit !== false,
        });
      } catch (e) {
        // 中断必须换成 CancelledError，否则会被 runShopBatch 当成致命错误终止整个任务
        if (e instanceof AbortedError) throw new jobs.CancelledError(e.message);
        c.done += 1;
        c.fail += 1;
        ctx.emit({ type: 'file-error', index: unit.index, rel: unit.rel, error: e.message });
      }
    },
    finalEvent: ({ cancelledByUser, ctx }) => Object.assign(
      { type: cancelledByUser ? 'cancelled' : 'summary', total },
      ctx.counters,
    ),
    fatalPrefix: '压缩任务异常：',
  });
}

module.exports = { runBatch, isRunning, isCancelled };
