// 视频上传页 · 批量上传编排：启动任务 / SSE 事件分流 / 进度统计 / 取消。
// 从 video/App.vue 抽出（与表格解析、凭证管理解耦）。
import { ref } from 'vue';
import { ElMessage } from 'element-plus';
import { useLog } from '../composables/useToolPage.js';

export function useVideoUpload({ site, isPh, siteLabel }) {
  const { logLines, log, clear: clearLog } = useLog();
  const autoScroll = ref(true);
  const uploading = ref(false);
  const summary = ref('');
  const currentJobId = ref('');
  let cancelledFlag = false;
  let es = null;

  function cancelUpload() {
    if (!currentJobId.value) return;
    fetch('/api/cancel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jobId: currentJobId.value }),
    })
      .then((r) => r.json())
      .then((d) => {
        if (d.ok) log('正在取消…', 'err');
        else log(`取消失败: ${d.message || '未知错误'}`, 'err');
      })
      .catch((e) => log('取消失败: ' + e.message, 'err'));
  }

  /**
   * 启动上传。
   * @param {Array} rows 预览行（用于回填状态）
   * @param {object} creds { auth, cookie, shopId, userid }
   * @param {() => boolean} assertReady 凭证校验（返回 false 直接中止）
   * @returns {Promise<boolean>} 是否已启动
   */
  function startUpload(rows, creds, assertReady) {
    if (!rows.length) { ElMessage.warning('请先解析并导入表格'); return false; }
    if (!assertReady()) return false;

    uploading.value = true;
    cancelledFlag = false;
    currentJobId.value = '';
    clearLog();
    summary.value = '';
    log(`开始批量上传（${siteLabel.value}），共 ${rows.length} 个任务`, 'ok');

    const mapped = rows.map((r) => ({ path: r.path, caption: r.caption, product: r.product }));

    fetch('/api/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        site: site.value,
        rows: mapped,
        auth: (creds.auth || '').trim(),
        cookie: (creds.cookie || '').trim(),
        shopId: (creds.shopId || '').trim(),
        userid: (creds.userid || '').trim(),
      }),
    })
      .then((r) => r.json())
      .then(({ jobId }) => {
        currentJobId.value = jobId;
        es = new EventSource('/api/events?jobId=' + jobId);
        let done = 0, ok = 0, fail = 0, total = 0;
        const updateSummary = () => {
          summary.value = `进度：${done} / ${total}　成功 ${ok} / 失败 ${fail}`;
        };
        es.onmessage = (ev) => {
          const d = JSON.parse(ev.data);
          const row = rows[d.index];
          if (d.type === 'row-start') {
            total = d.total;
            updateSummary();
            if (row) row.status = 'run';
            log(`▶ 任务 ${d.index + 1}/${d.total}: ${d.row.path}`);
          } else if (d.type === 'step') {
            log(`    [${d.index + 1}] (${d.step}) ${d.msg}`);
          } else if (d.type === 'row-done') {
            done++; ok++;
            updateSummary();
            if (row) row.status = 'ok';
            log(`  ✓ 任务 ${d.index + 1} 完成 → vid=${d.result.vid}` + (d.result.itemId ? ` item_id=${d.result.itemId}` : ''), 'ok');
          } else if (d.type === 'row-error') {
            done++; fail++;
            updateSummary();
            if (row) row.status = 'err';
            log(`  ✗ 任务 ${d.index + 1} 失败: ${d.error}`, 'err');
          } else if (d.type === 'finished') {
            log(`全部完成：成功 ${ok}，失败 ${fail}，共 ${d.total}`, ok ? 'ok' : 'err');
            summary.value = `已完成：成功 ${ok} / 失败 ${fail}`;
            finish();
          } else if (d.type === 'cancelled') {
            log(`已取消：已处理 ${d.done} / ${d.total}（成功 ${ok}，失败 ${fail}）`, 'err');
            summary.value = `已取消：成功 ${ok} / 失败 ${fail}`;
            cancelledFlag = true;
            finish();
          } else if (d.type === 'fatal') {
            log('致命错误: ' + d.error, 'err');
            finish();
          }
        };
        es.onerror = () => {
          // 取消后服务端主动断开连接，属正常流程，不当作错误
          if (cancelledFlag) return;
          log('SSE 连接中断', 'err');
          finish();
        };
      })
      .catch((e) => {
        log('启动失败: ' + e.message, 'err');
        uploading.value = false;
      });
    return true;
  }

  function finish() {
    uploading.value = false;
    currentJobId.value = '';
    if (es) { es.close(); es = null; }
  }

  function dispose() {
    if (es) es.close();
  }

  return { logLines, log, clearLog, autoScroll, uploading, summary, currentJobId, startUpload, cancelUpload, finish, dispose };
}
