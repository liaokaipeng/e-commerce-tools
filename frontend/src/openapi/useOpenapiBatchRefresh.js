// 开放平台页 · 批量刷新 token：SSE 进度状态机（batch/batchProgress）与取消。
// 从 openapi/App.vue 抽出；后端按共享 token 分组去重后逐组整组续期（见 server/openapi/refresh-all.js），
// 这里只消费 SSE 进度。刷新结束后统一 refreshStatus 拉取最新状态。
import { reactive, computed } from 'vue';
import { ElMessage } from 'element-plus';
import { runSSE } from '../composables/useSSE.js';

export function useOpenapiBatchRefresh({ refreshStatus }) {
  const batch = reactive({ running: false, jobId: '', done: 0, total: 0, synced: 0, failed: 0, skipped: 0 });
  const batchProgress = computed(() => {
    const p = batch.total ? `${batch.done}/${batch.total} 组` : '准备中';
    const tail = batch.skipped ? `，跳过 ${batch.skipped} 店` : '';
    return `批量刷新中…（${p}，已续期 ${batch.synced} 店${tail}）`;
  });

  async function refreshAll() {
    if (batch.running) return;
    Object.assign(batch, { running: true, jobId: '', done: 0, total: 0, synced: 0, failed: 0, skipped: 0 });
    try {
      await runSSE('/api/openapi/refresh-all/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      }, (ev) => {
        if (ev.type === 'start') {
          batch.jobId = ev.jobId || '';
          batch.total = ev.totalGroups || 0;
        } else if (ev.type === 'group-done') {
          batch.done += 1;
          if (ev.ok) batch.synced += ev.synced || 0;
          else batch.failed += 1;
        } else if (ev.type === 'skipped') {
          batch.skipped += ev.size || 0;
        } else if (ev.type === 'summary') {
          batch.synced = ev.synced || 0;
          batch.failed = ev.failed || 0;
          batch.skipped = ev.skipped || batch.skipped;
          ElMessage.success(ev.msg || '批量刷新完成');
        } else if (ev.type === 'cancelled') {
          ElMessage.warning(ev.msg || '已取消批量刷新');
        } else if (ev.type === 'fatal') {
          ElMessage.error(ev.msg || '批量刷新失败');
        }
      }, (msg) => ElMessage.error(msg));
    } catch (e) {
      ElMessage.error('批量刷新失败：' + e.message);
    } finally {
      batch.running = false;
      batch.jobId = '';
      await refreshStatus();
    }
  }

  // 取消批量刷新：后端在下一个组间门控点退出（进行中的那一组会跑完）
  async function cancelRefreshAll() {
    if (!batch.jobId) return;
    try {
      await fetch('/api/openapi/refresh-all/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId: batch.jobId }),
      });
    } catch { /* 忽略：SSE 断开后后端也会按取消收尾 */ }
  }

  return { batch, batchProgress, refreshAll, cancelRefreshAll };
}
