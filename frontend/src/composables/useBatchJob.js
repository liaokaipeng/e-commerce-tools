// 批量任务组合式函数：预览表格行状态 + SSE 执行 + 暂停/继续/取消。
// bidding-cancel / hotlisting-cancel 两页原先各写一份同源代码（行状态映射、SSE 事件分流、
// 进度统计、任务控制按钮），现统一到本文件，页面只保留各自的事件文案差异（overrides）。
import { ref, computed } from 'vue';
import { ElMessage } from 'element-plus';
import { runSSE } from './useToolPage.js';

/** 行状态：'' 等待 | 'run' 进行中 | 'ok' 成功 | 'err' 失败 */
export const STATUS_TAG = { '': 'info', run: 'warning', ok: 'success', err: 'danger' };
export const STATUS_TEXT = { '': '等待', run: '进行中', ok: '成功', err: '失败' };

function postJson(url, body) {
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).then((r) => r.json().catch(() => ({})));
}

/**
 * @param {object} o
 *   - runUrl       SSE 执行接口（如 '/api/bidding-cancel/run'）
 *   - controlBase  任务控制接口前缀（如 '/api/bidding-cancel'，提供 pause/resume/cancel）
 *   - log          页面日志函数
 *   - rowKeyOf     (row) => 表格行唯一键；事件里的 shopId 用于回填行状态
 *   - overrides    事件文案覆盖钩子 { [事件类型]: (ev, ctx) => { cls?, msg? } }，
 *                  返回 { cls, msg } 即覆盖默认渲染；返回 falsy 走默认渲染
 *   - onFinish     执行结束（summary / cancelled）回调
 */
export function useBatchJob({ runUrl, controlBase, log, rowKeyOf, overrides = {}, onFinish }) {
  const running = ref(false);
  const rows = ref([]);
  const jobId = ref('');
  const paused = ref(false);
  const pausing = ref(false);
  const cancelled = ref(false);
  const progress = ref({ done: 0, ok: 0, fail: 0, total: 0 });

  const totalCount = computed(() => progress.value.total);
  const isBusy = computed(() => running.value);

  function reset() {
    rows.value = [];
    progress.value = { done: 0, ok: 0, fail: 0, total: 0 };
    cancelled.value = false;
  }

  /** 按事件里的 shopId 找到预览行并置状态（预览行与执行行按 rowKeyOf 对齐） */
  function markRow(ev, status) {
    if (!ev || ev.shopId === undefined) return;
    const key = rowKeyOf ? rowKeyOf(ev) : String(ev.shopId);
    const row = rows.value.find((r) => rowKeyOf(r) === key);
    if (row) row.status = status;
  }

  /** 默认事件渲染（两页共有的进度 / 完成类事件）；返回 true 表示已渲染 */
  function renderDefault(ev) {
    switch (ev.type) {
      case 'shop-done':
        progress.value.done += 1;
        markRow(ev, ev.ok ? 'ok' : 'err');
        if (ev.ok) log(`✓ ${ev.name}（${ev.shopId}）完成：成功 ${ev.okCount || ev.cancelled || 0} 条，失败 ${ev.failed} 条。`, ev.failed ? 'err' : 'ok');
        else log(`✕ ${ev.name}（${ev.shopId}）失败：${ev.msg}`, 'err');
        return true;
      case 'summary':
        progress.value.ok = ev.success || 0;
        progress.value.fail = ev.failed || 0;
        log(`全部完成：共处理 ${ev.cancelled} 条，失败 ${ev.failed} 条（${ev.success}/${ev.total} 个店铺成功）。`, ev.failed ? 'err' : 'ok');
        return true;
      case 'cancelled':
        cancelled.value = true;
        progress.value.ok = ev.success || 0;
        progress.value.fail = ev.failed || 0;
        log(`已取消：已处理 ${ev.cancelled} 条，失败 ${ev.failed} 条（${ev.success}/${ev.total} 个店铺完成）。`, 'err');
        return true;
      default:
        return false;
    }
  }

  /**
   * 执行批量任务。
   * @param {Array} payloadRows 预览行（用于回填状态；传 [] 表示无预览表格）
   * @param {object} body 发起 run 的请求体
   * @returns {Promise<boolean>} 是否成功读完整条事件流
   */
  async function start(payloadRows, body) {
    rows.value = Array.isArray(payloadRows) ? payloadRows : [];
    for (const r of rows.value) if (!r.status) r.status = '';
    running.value = true;
    cancelled.value = false;
    jobId.value = '';
    paused.value = false;
    progress.value = { done: 0, ok: 0, fail: 0, total: rows.value.length };
    let sawEnd = false;
    try {
      const okRead = await runSSE(runUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }, (ev) => {
        if (ev.type === 'start') { jobId.value = ev.jobId; return; }
        if (ev.type === 'fatal') { log(ev.msg, 'err'); return; }
        if (ev.type === 'summary' || ev.type === 'cancelled') sawEnd = true;
        // 事件类型 → 行状态（两页共有的）
        if (ev.type === 'sku-done' || ev.type === 'bid-done') markRow(ev, ev.ok ? 'ok' : 'err');
        if (ev.type === 'shop-start') markRow(ev, 'run');
        const custom = overrides[ev.type] && overrides[ev.type](ev, { progress, markRow });
        if (custom) { if (custom.msg) log(custom.msg, custom.cls || 'info'); return; }
        renderDefault(ev);
      }, log);
      // 服务端未发收尾事件（如 SSE 中途断开）时补一次提示，避免页面停留在「进行中」
      if (okRead && !sawEnd) log('事件流提前结束，任务可能未完整执行，请刷新后重试。', 'err');
      return okRead;
    } catch (e) {
      log('请求失败：' + e.message, 'err');
      return false;
    } finally {
      running.value = false;
      jobId.value = '';
      paused.value = false;
      if (onFinish) onFinish({ cancelled: cancelled.value });
    }
  }

  async function togglePause() {
    if (!jobId.value || pausing.value) return;
    pausing.value = true;
    try {
      const next = !paused.value;
      const j = await postJson(`${controlBase}/${next ? 'pause' : 'resume'}`, { jobId: jobId.value });
      if (j && j.ok) {
        paused.value = next;
        log(next ? '⏸ 已暂停，点击「继续」恢复执行。' : '▶ 已恢复执行…', 'info');
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
      const j = await postJson(`${controlBase}/cancel`, { jobId: jobId.value });
      if (j && j.ok) log('正在取消，已处理的部分保留…', 'err');
      else ElMessage.warning((j && j.msg) || '取消失败，任务可能已结束');
    } catch (e) {
      ElMessage.error('取消失败：' + e.message);
    }
  }

  return { running, rows, jobId, paused, pausing, cancelled, progress, totalCount, isBusy, start, togglePause, cancel, reset };
}

/**
 * 预览扫描组合式函数：调 preview 接口、回显店铺级日志、记录可操作条数与耗时。
 * @param {object} o { url, log, summarize: (shop) => { ok, msg, count } }
 */
export function usePreviewScan({ url, log, summarize }) {
  const scanning = ref(false);
  const shops = ref([]);
  const done = ref(false);
  const totalCount = computed(() => shops.value.reduce((n, s) => n + (summarize(s).count || 0), 0));

  async function scan(body) {
    scanning.value = true;
    done.value = false;
    shops.value = [];
    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const j = await resp.json();
      if (!j || !j.shops) {
        log((j && j.msg) || '扫描请求失败', 'err');
        return false;
      }
      shops.value = j.shops;
      for (const s of j.shops) {
        const r = summarize(s);
        log(r.msg, r.ok ? 'ok' : 'err');
      }
      done.value = true;
      return true;
    } catch (e) {
      log('扫描请求失败：' + e.message, 'err');
      return false;
    } finally {
      scanning.value = false;
    }
  }

  return { scanning, shops, done, totalCount, scan };
}
