// 压缩任务组合式函数：扫描预览 + SSE 执行 + 暂停/继续/取消。
// 与 useBatchJob 的差别：压缩的进度粒度是「单个文件内的百分比」，且行由服务端 files 事件定序，
// 故单独一份而不套用面向店铺的 useBatchJob。
import { ref, computed } from 'vue';
import { ElMessage } from 'element-plus';
import { postJson } from '../composables/api.js';
import { runSSE } from '../composables/useSSE.js';
import { formatBytes, formatDuration, ratioText } from './compress-format.js';

export function useCompressJob({ log }) {
  // ---------- 扫描预览 ----------
  const scanning = ref(false);
  const scanned = ref(false);
  const truncated = ref(false);
  const emptyDirs = ref(0);

  const rows = ref([]);
  const totalSize = ref(0);
  const overSizeCount = computed(() => rows.value.filter((r) => r.overSize).length);

  // ---------- 执行状态 ----------
  const running = ref(false);
  const jobId = ref('');
  const paused = ref(false);
  const pausing = ref(false);
  const finished = ref(false);
  const progress = ref({ done: 0, ok: 0, skip: 0, fail: 0, total: 0 });
  const savedBytes = ref(0);
  const outDirShown = ref('');
  const overwriteMode = ref(false);

  const progressPct = computed(() => {
    const p = progress.value;
    if (!p.total) return 0;
    // 行级进度 + 当前文件内的百分比，避免大文件时进度条长时间不动
    const cur = rows.value.find((r) => r.status === 'run');
    const inner = cur && cur.percent ? cur.percent / 100 : 0;
    return Math.min(100, Math.round(((p.done + inner) / p.total) * 100));
  });

  function resetRows() {
    for (const r of rows.value) {
      r.status = '';
      r.percent = 0;
      r.detail = '';
      r.error = '';
    }
  }

  /** 扫描文件夹（只按体积预判，不逐文件探测时长，保持秒回） */
  async function scan(dir) {
    scanning.value = true;
    rows.value = [];
    scanned.value = false;
    try {
      const j = await postJson('/api/compress/scan', { dir });
      if (!j || !j.ok) {
        log((j && j.message) || '扫描失败', 'err');
        return false;
      }
      truncated.value = !!j.truncated;
      emptyDirs.value = j.emptyDirs || 0;
      totalSize.value = j.totalSize || 0;
      rows.value = (j.files || []).map((f) => Object.assign({}, f, {
        status: '', percent: 0, detail: '', error: '', duration: null,
      }));
      scanned.value = true;
      if (truncated.value) {
        log(`⚠ 视频数量超过上限，只列出前 ${rows.value.length} 个，请分文件夹处理。`, 'warn');
      }
      if (!rows.value.length) {
        log(`该文件夹（含子目录）里没有找到视频文件${dir ? '：' + dir : ''}`, 'err');
      } else {
        log(`扫描完成：共 ${rows.value.length} 个视频，合计 ${formatBytes(totalSize.value)}`
          + `，其中 ${overSizeCount.value} 个超过体积上限。`, 'ok');
      }
      return true;
    } catch (e) {
      log('扫描失败：' + e.message, 'err');
      return false;
    } finally {
      scanning.value = false;
    }
  }

  /** 开始压缩（SSE） */
  async function start(body) {
    if (!rows.value.length) {
      ElMessage.warning('请先扫描文件夹');
      return false;
    }
    resetRows();
    running.value = true;
    finished.value = false;
    jobId.value = '';
    paused.value = false;
    savedBytes.value = 0;
    outDirShown.value = '';
    overwriteMode.value = !!body.overwrite;
    progress.value = { done: 0, ok: 0, skip: 0, fail: 0, total: rows.value.length };

    let sawEnd = false;
    try {
      const okRead = await runSSE('/api/compress/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }, (ev) => {
        switch (ev.type) {
          case 'start':
            jobId.value = ev.jobId;
            progress.value.total = ev.total || rows.value.length;
            outDirShown.value = ev.outDir || '';
            break;
          case 'files': {
            // 以服务端的顺序为准重建行，保证 index 与后续事件严格对齐
            const prev = rows.value;
            rows.value = (ev.files || []).map((f, i) => Object.assign(
              { status: '', percent: 0, detail: '', error: '', duration: null, overSize: false },
              prev[i] && prev[i].rel === f.rel ? { overSize: prev[i].overSize } : {},
              f,
            ));
            break;
          }
          case 'file-start': {
            const r = rows.value[ev.index];
            if (r) { r.status = 'run'; r.percent = 0; }
            break;
          }
          case 'file-probe': {
            const r = rows.value[ev.index];
            if (r) r.duration = ev.duration;
            break;
          }
          case 'file-progress': {
            const r = rows.value[ev.index];
            if (r) r.percent = ev.percent;
            break;
          }
          case 'file-done': {
            const r = rows.value[ev.index];
            progress.value.done += 1;
            if (ev.skipped) {
              progress.value.skip += 1;
              const row = rows.value[ev.index];
              if (row) { row.status = 'skip'; row.percent = 100; row.detail = ev.reason || '已达标'; }
              log(`○ ${nameOf(row, ev)} 已达标，跳过（${formatBytes(ev.sizeBefore)} / ${formatDuration(ev.durationBefore)}）`, 'info');
            } else {
              progress.value.ok += 1;
              savedBytes.value += Math.max(0, (ev.sizeBefore || 0) - (ev.sizeAfter || 0));
              const ratio = ratioText(ev.sizeBefore, ev.sizeAfter);
              const extra = ev.speedRatio > 1 ? `，${ev.speedRatio.toFixed(2)}× 加速` : '';
              // 覆盖模式：ev.overwritten 为真才是真的替换了原文件；否则是「复核未通过、已保留原文件」
              const overwriteTip = ev.overwritten ? '，已覆盖原文件' : '';
              const kept = overwriteMode.value && !ev.overwritten;
              if (r) {
                r.status = 'ok';
                r.percent = 100;
                r.detail = `${formatBytes(ev.sizeBefore)} → ${formatBytes(ev.sizeAfter)}（${ratio}），`
                  + `${formatDuration(ev.durationBefore)} → ${formatDuration(ev.durationAfter)}${extra}${overwriteTip}`
                  + (kept ? `（${ev.reason || '已保留原文件'}）` : '');
              }
              log(`✓ ${nameOf(r, ev)} 压缩完成：${formatBytes(ev.sizeBefore)} → ${formatBytes(ev.sizeAfter)}（${ratio}），`
                + `时长 ${formatDuration(ev.durationBefore)} → ${formatDuration(ev.durationAfter)}${extra}${overwriteTip}`
                + `${ev.withinLimit === false ? ' ⚠ 仍超出体积上限' : ''}`, ev.withinLimit === false ? 'err' : 'ok');
              if (kept) log(`⚠ ${nameOf(r, ev)} ${ev.reason || '未覆盖，已保留原文件'}`, 'warn');
            }
            break;
          }
          case 'file-error': {
            const r = rows.value[ev.index];
            progress.value.done += 1;
            progress.value.fail += 1;
            if (r) { r.status = 'err'; r.percent = 100; r.error = ev.error; }
            log(`✕ ${ev.rel || (r && r.rel) || ''} 失败：${ev.error}`, 'err');
            break;
          }
          case 'summary':
            sawEnd = true;
            applyFinal(ev);
            log(`全部完成：压缩 ${ev.ok} 个，已达标跳过 ${ev.skip} 个，失败 ${ev.fail} 个；`
              + `共省下 ${formatBytes(ev.before - ev.after)}。`, ev.fail ? 'err' : 'ok');
            break;
          case 'cancelled':
            sawEnd = true;
            applyFinal(ev);
            log(`已取消：已处理 ${ev.done} 个（成功 ${ev.ok} / 跳过 ${ev.skip} / 失败 ${ev.fail}），已完成的产物保留。`, 'err');
            break;
          case 'fatal':
            log(ev.msg, 'err');
            break;
          default:
            break;
        }
      }, log);
      // 服务端未发收尾事件（如 SSE 中途断开）时补一次提示，避免页面停留在「进行中」
      if (okRead && !sawEnd) log('事件流提前结束，任务可能未完整执行，请检查输出目录后重试。', 'err');
      return okRead;
    } catch (e) {
      log('请求失败：' + e.message, 'err');
      return false;
    } finally {
      running.value = false;
      jobId.value = '';
      paused.value = false;
      finished.value = true;
    }
  }

  function nameOf(row, ev) {
    return (row && row.rel) || ev.rel || ev.outPath || '';
  }

  function applyFinal(ev) {
    progress.value.ok = ev.ok || 0;
    progress.value.skip = ev.skip || 0;
    progress.value.fail = ev.fail || 0;
    progress.value.done = ev.done || 0;
    if (typeof ev.total === 'number') progress.value.total = ev.total;
  }

  async function togglePause() {
    if (!jobId.value || pausing.value) return;
    pausing.value = true;
    try {
      const next = !paused.value;
      const j = await postJson(`/api/compress/${next ? 'pause' : 'resume'}`, { jobId: jobId.value });
      if (j && j.ok) {
        paused.value = next;
        log(next ? '⏸ 已暂停，点击「继续」恢复（当前文件会先压完）。' : '▶ 已恢复执行…', 'info');
      } else {
        ElMessage.warning((j && j.msg) || '操作失败，任务可能已结束');
      }
    } catch (e) {
      ElMessage.error('操作失败：' + e.message);
    } finally {
      pausing.value = false;
    }
  }

  async function cancel() {
    if (!jobId.value) return;
    try {
      const j = await postJson('/api/compress/cancel', { jobId: jobId.value });
      if (j && j.ok) log('正在取消，当前文件会被中断，已完成的产物保留…', 'err');
      else ElMessage.warning((j && j.msg) || '取消失败，任务可能已结束');
    } catch (e) {
      ElMessage.error('取消失败：' + e.message);
    }
  }

  return {
    scanning, scanned, truncated, emptyDirs,
    rows, totalSize, overSizeCount,
    running, jobId, paused, pausing, finished, progress, progressPct, savedBytes, outDirShown,
    scan, start, togglePause, cancel,
  };
}
