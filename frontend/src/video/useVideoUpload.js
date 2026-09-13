// 视频上传页 · 批量上传编排：启动任务 / 传输（POST + SSE）/ 终态处理 / 取消。
// 单条事件如何映射成进度、日志与行状态属于纯逻辑，见 upload-events.js；本模块只做编排与传输。
import { ref } from 'vue';
import { ElMessage } from 'element-plus';
import { useLog } from '../composables/useLog.js';
import { reduceUploadEvent } from './upload-events.js';

export function useVideoUpload({ site, isPh, siteLabel, onFinish }) {
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
        let stats = { done: 0, ok: 0, fail: 0, skip: 0, total: 0 };
        es.onmessage = (ev) => {
          const d = JSON.parse(ev.data);
          const res = reduceUploadEvent(d, stats);
          stats = res.stats;
          if (res.row) {
            const row = rows[res.row.index];
            if (row) row.status = res.row.status;
          }
          if (res.log) log(res.log.msg, res.log.cls);
          if (res.summary !== null) summary.value = res.summary;
          if (res.terminal) {
            if (res.terminal === 'cancelled') cancelledFlag = true;
            finish();
            // 任务正常结束或取消后导出带【状态】列的结果表格（保留已处理行的状态）；致命错误不导出
            if (res.terminal !== 'fatal' && onFinish) {
              try { onFinish(res.finish); } catch (e) { /* 导出失败不影响主流程 */ }
            }
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
