// 视频上传页 · SSE 上传事件 → 进度/日志映射（纯函数，不依赖 Vue）。
// 后端逐条推事件，本模块把单条事件翻译成「计数更新 + 日志 + 预览行状态 + 汇总文案 + 终态」，
// useVideoUpload 只负责把结果落到响应式状态并处理终态回调。
// 文案与计数口径必须与拆分前完全一致（含全角空格 U+3000）。

/** 进度汇总文案（含商品为空跳过数） */
export function formatProgress({ done, total, ok, fail, skip }) {
  return `进度：${done} / ${total}　成功 ${ok} / 失败 ${fail}` + (skip ? `（含商品为空跳过 ${skip}）` : '');
}

/** 跳过数后缀（统一 full-width 括号口径） */
function skipSuffix(skip) {
  return skip ? `（含商品为空跳过 ${skip}）` : '';
}

/**
 * 归约单条上传事件。
 * @param {object} d 后端 SSE 事件
 * @param {{done:number, ok:number, fail:number, skip:number, total:number}} stats 当前计数
 * @returns {{ stats, log: {msg, cls}|null, row: {index, status}|null, summary: string|null,
 *             terminal: ''|'finished'|'cancelled'|'fatal', finish: {ok,fail,skip}|null }}
 */
export function reduceUploadEvent(d, stats) {
  const next = { ...stats };
  const out = { stats: next, log: null, row: null, summary: null, terminal: '', finish: null };

  if (d.type === 'row-start') {
    next.total = d.total;
    out.summary = formatProgress(next);
    out.row = { index: d.index, status: 'run' };
    out.log = { msg: `▶ 任务 ${d.index + 1}/${d.total}: ${d.row.path}`, cls: 'info' };
  } else if (d.type === 'step') {
    out.log = { msg: `    [${d.index + 1}] (${d.step}) ${d.msg}`, cls: 'info' };
  } else if (d.type === 'row-done') {
    next.done++;
    next.ok++;
    out.summary = formatProgress(next);
    out.row = { index: d.index, status: 'ok' };
    out.log = { msg: `  ✓ 任务 ${d.index + 1} 完成 → vid=${d.result.vid}` + (d.result.itemId ? ` item_id=${d.result.itemId}` : ''), cls: 'ok' };
  } else if (d.type === 'row-error') {
    next.done++;
    if (d.skip) {
      // 后端判定「商品为空」跳过上传：状态列显示「失败，商品为空」
      next.skip++;
      out.summary = formatProgress(next);
      out.row = { index: d.index, status: 'no-product' };
      out.log = { msg: `  ⊘ 任务 ${d.index + 1} 跳过（不上传）: ${d.error}`, cls: 'err' };
    } else {
      next.fail++;
      out.summary = formatProgress(next);
      out.row = { index: d.index, status: 'err' };
      out.log = { msg: `  ✗ 任务 ${d.index + 1} 失败: ${d.error}`, cls: 'err' };
    }
  } else if (d.type === 'finished') {
    out.log = { msg: `全部完成：成功 ${next.ok}，失败 ${next.fail}` + skipSuffix(next.skip) + `，共 ${d.total}`, cls: next.ok ? 'ok' : 'err' };
    out.summary = `已完成：成功 ${next.ok} / 失败 ${next.fail}` + skipSuffix(next.skip);
    out.terminal = 'finished';
    out.finish = { ok: next.ok, fail: next.fail, skip: next.skip };
  } else if (d.type === 'cancelled') {
    out.log = { msg: `已取消：已处理 ${d.done} / ${d.total}（成功 ${next.ok}，失败 ${next.fail}` + (next.skip ? `，含商品为空跳过 ${next.skip}` : '') + `）`, cls: 'err' };
    out.summary = `已取消：成功 ${next.ok} / 失败 ${next.fail}` + skipSuffix(next.skip);
    out.terminal = 'cancelled';
    out.finish = { ok: next.ok, fail: next.fail, skip: next.skip };
  } else if (d.type === 'fatal') {
    out.log = { msg: '致命错误: ' + d.error, cls: 'err' };
    out.terminal = 'fatal';
  }

  return out;
}
