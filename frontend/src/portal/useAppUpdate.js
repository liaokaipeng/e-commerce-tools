// 应用自更新：版本展示、更新检查（静默 + 手动）、一键更新 SSE 进度。
import { ref, onMounted } from 'vue';
import { ElMessage } from 'element-plus';
import { runSSE } from '../composables/useSSE.js';
import { getJsonResult, postJsonResult } from '../composables/api.js';

export function useAppUpdate() {
  const ver = ref({ version: '', commit: null, builtAt: null });
  const upd = ref({ configured: false, enabled: true, hasUpdate: false, latest: null, current: {}, notes: '', url: '', sha256: '', builtAt: null, checkedAt: null, error: null });
  const updateDrawer = ref(false);
  const checking = ref(false);
  const applying = ref(false);
  const steps = ref([]);
  const doneInfo = ref(null);
  const restarting = ref(false);

  async function loadVersion() {
    try {
      const s = await getJsonResult('/api/version');
      if (s.ok) ver.value = s;
    } catch { /* 服务不可达时侧栏显示占位符即可 */ }
  }

  /** 拉取更新清单并比对；失败静默（侧栏显示「检查失败」小点），手动触发时才提示 */
  async function checkUpdate(manual = false) {
    checking.value = true;
    try {
      const s = await getJsonResult('/api/update/check');
      if (s.ok) upd.value = s;
      if (manual) {
        if (s.error) ElMessage.warning('检查更新失败：' + s.error);
        else if (s.hasUpdate) ElMessage.success(`发现新版本 v${s.latest}`);
        else ElMessage.success(`已是最新版本 v${ver.value.version}`);
      }
    } catch {
      if (manual) ElMessage.warning('检查更新失败：连接服务失败');
    } finally {
      checking.value = false;
    }
  }

  /** 一键更新：SSE 进度（下载 → 校验 → 解压 → 备份 → 覆盖 → 依赖） */
  async function applyUpdate() {
    applying.value = true;
    steps.value = [];
    doneInfo.value = null;
    try {
      await runSSE('/api/update/apply', { method: 'POST' }, (ev) => {
        if (ev.phase === 'done') {
          doneInfo.value = ev;
          autoRestart();
        } else if (ev.phase === 'error') {
          steps.value.push({ phase: 'error', message: ev.message });
        } else if (ev.phase === 'download' && typeof ev.percent === 'number') {
          // 下载进度覆盖同阶段最新一条，避免刷屏
          const last = steps.value[steps.value.length - 1];
          if (last && last.phase === 'download') last.percent = ev.percent;
          else steps.value.push({ phase: ev.phase, message: ev.message, percent: ev.percent });
        } else {
          steps.value.push({ phase: ev.phase, message: ev.message });
        }
      }, () => {});
    } finally {
      applying.value = false;
      checkUpdate();
    }
  }

  function openUpdate() {
    updateDrawer.value = true;
    if (!upd.value.checkedAt) checkUpdate();
  }

  /**
   * 更新成功后自动重启：后端拉起 启动.bat（新版 bat 会结束旧实例与旧黑窗口），
   * 这里轮询 /api/version 直到新版本就绪再刷新页面；失败回落到「双击 启动.bat」的手动提示。
   */
  async function autoRestart() {
    restarting.value = true;
    let accepted = false;
    try {
      // 旧版本后端没有该接口（404）或响应途中服务被结束，都视为未接管重启
      accepted = (await postJsonResult('/api/update/restart', {})).ok;
    } catch { /* 连接被切断属正常 */ }
    if (!accepted) {
      restarting.value = false;
      return;
    }
    const target = doneInfo.value && doneInfo.value.version;
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      try {
        const s = await getJsonResult('/api/version');
        if (s && s.version && (!target || s.version === target)) {
          location.reload();
          return;
        }
      } catch { /* 新进程还没开始监听，拒连是正常的 */ }
    }
    restarting.value = false;
  }

  function downloadPackage() {
    if (upd.value.url) window.open(upd.value.url, '_blank');
  }

  // 版本显示与更新检查（静默，失败不打扰）
  onMounted(() => {
    loadVersion();
    checkUpdate();
  });

  return { ver, upd, updateDrawer, checking, applying, steps, doneInfo, restarting, checkUpdate, applyUpdate, openUpdate, downloadPackage };
}
