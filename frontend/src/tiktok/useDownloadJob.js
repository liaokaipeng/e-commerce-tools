// TikTok 下载页 · 下载任务编排：链接解析 / 发起 SSE 下载 / 事件映射 / 进度汇总 / 停止。
import { ref, computed } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { runSSE } from '../composables/useSSE.js';

/**
 * 下载任务编排子系统。
 * @param {object} o
 *   - dir           保存目录 Ref（来自 useDirSettings）
 *   - hasDefault    是否已有默认目录 Ref（来自 useDirSettings）
 *   - setDefaultDir 设置默认目录方法（来自 useDirSettings）
 *   - log           页面日志函数
 *   - clear         清空日志方法
 *   - showVpn       网络异常提示 Ref（来自 useTiktokNetwork）
 */
export function useDownloadJob({ dir, hasDefault, setDefaultDir, log, clear: clearLog, showVpn }) {
  const urls = ref('');
  const downloading = ref(false);
  const abortRef = ref(null);
  const progress = ref({ show: false, done: 0, ok: 0, fail: 0, total: 0 });
  const summary = ref({ show: false, text: '', color: '' });

  const validCount = computed(() => {
    return urls.value
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter((s) => /^https?:\/\/(www\.|vm\.|vt\.|v\.)?tiktok\.com\//i.test(s)).length;
  });

  const progressPct = computed(() =>
    progress.value.total ? Math.round((progress.value.done / progress.value.total) * 100) : 0
  );

  function handleEvent(ev) {
    switch (ev.type) {
      case 'info':
        log(ev.message, 'info', '提示');
        break;
      case 'start':
        log(`(${ev.index}/${ev.total}) ${ev.url}`, 'title', '下载');
        break;
      case 'log':
        log(ev.message, 'warn');
        break;
      case 'done': {
        progress.value.done++;
        if (ev.ok) {
          progress.value.ok++;
          log(ev.message, 'ok', '成功');
        } else {
          progress.value.fail++;
          log(ev.message, ev.network ? 'network' : 'err', '跳过');
        }
        break;
      }
      case 'fatal':
        log(ev.message, 'err', '错误');
        break;
      case 'summary': {
        summary.value = {
          show: true,
          text: ev.message,
          color: ev.failed > 0 ? '#e5484d' : '#25c16d',
        };
        break;
      }
    }
  }

  async function startDownload() {
    if (downloading.value) return;
    const list = urls.value
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (list.length === 0) {
      log('请先输入至少一个 TikTok 视频链接', 'err');
      return;
    }
    const d = dir.value.trim();
    if (!d) {
      log('请先选择保存目录', 'err');
      ElMessage.warning('请先选择保存目录');
      return;
    }
    if (!hasDefault.value) {
      try {
        await ElMessageBox.confirm(
          `是否将「${d}」设为默认目录？下次打开会自动使用该目录。`,
          '默认目录',
          { confirmButtonText: '设为默认', cancelButtonText: '暂不', type: 'info' }
        );
        await setDefaultDir(d);
      } catch {
        /* 用户取消，继续下载 */
      }
    }
    downloading.value = true;
    showVpn.value = false;
    clearLog();
    summary.value = { show: false, text: '', color: '' };

    log(`开始任务：共 ${list.length} 个链接`, 'title', '任务');
    let networkIssue = false;
    progress.value = { show: true, done: 0, ok: 0, fail: 0, total: list.length };

    const controller = new AbortController();
    abortRef.value = controller;
    try {
      await runSSE('/api/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ urls: list.join('\n'), dir: d }),
        signal: controller.signal,
      }, (ev) => {
        handleEvent(ev);
        if (ev.network) networkIssue = true;
      }, log);
    } catch (e) {
      if (e.name === 'AbortError') {
        log('已手动停止下载任务', 'warn', '提示');
      } else {
        log('连接服务失败：' + e.message, 'err');
      }
    } finally {
      downloading.value = false;
      abortRef.value = null;
    }

    if (networkIssue && !abortRef.value) showVpn.value = true;
  }

  function stopDownload() {
    abortRef.value?.abort();
  }

  return { urls, downloading, progress, progressPct, summary, validCount, startDownload, stopDownload };
}
