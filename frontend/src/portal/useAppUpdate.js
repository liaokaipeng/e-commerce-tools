// 应用自更新：版本展示、更新检查（静默 + 手动）、一键更新 SSE 进度。
import { ref, onMounted, h } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
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
  // 旧版本后端（/api/version 没有 pid）：磁盘文件已是新版本，但黑色窗口里跑的还是旧进程。
  const staleBackend = ref(false);
  let remindedOldWindow = false;

  /** 比较版本号数字段，判断 a 是否低于 b（缺失按最低处理） */
  function isLowerVersion(a, b) {
    if (!a || !b) return true;
    const pa = String(a).split('.').map((x) => parseInt(x, 10) || 0);
    const pb = String(b).split('.').map((x) => parseInt(x, 10) || 0);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      const x = pa[i] || 0;
      const y = pb[i] || 0;
      if (x !== y) return x < y;
    }
    return false;
  }

  /**
   * 最明显的提醒：更新已落盘，但旧版本后端仍在黑色窗口中运行。
   * 用不可点遮罩/ESC 关闭的模态框，配合同步展示的侧栏与抽屉告警，避免用户忽略。
   */
  function remindOldWindowClose(oldVersion, newVersion) {
    if (remindedOldWindow) return;
    remindedOldWindow = true;
    const head = oldVersion && newVersion
      ? `更新前的版本 v${oldVersion} 低于当前版本 v${newVersion}：文件已更新，但旧版本的后端程序仍在黑色窗口中运行。`
      : '文件已更新，但旧版本的后端程序仍在黑色窗口中运行。';
    ElMessageBox.alert(
      h('div', { style: 'line-height:1.8' }, [
        h('p', { style: 'margin:0 0 8px;font-weight:600' }, head),
        h('p', { style: 'margin:0 0 8px' }, '请立即关闭旧的黑色命令窗口（Windows Terminal 中关闭对应标签页），再双击仓库里的「启动.bat」启动新版本。'),
        h('p', { style: 'margin:0;font-weight:600' }, '只关闭浏览器页面无效：服务仍由旧进程运行。'),
      ]),
      '更新完成：请关闭旧的黑窗口',
      {
        confirmButtonText: '我知道了',
        type: 'warning',
        showClose: false,
        closeOnClickModal: false,
        closeOnPressEscape: false,
      }
    ).catch(() => {});
  }

  async function loadVersion() {
    try {
      const s = await getJsonResult('/api/version');
      if (s.ok) {
        ver.value = s;
        // 低版本后端没有 pid/startedAt：页面已是新前端、磁盘也是新版本，但实际跑的仍是旧进程。
        if (!s.pid) {
          staleBackend.value = true;
          remindOldWindowClose();
        }
      }
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
    const oldVersion = ver.value.version || '';
    try {
      await runSSE('/api/update/apply', { method: 'POST' }, (ev) => {
        if (ev.phase === 'done') {
          doneInfo.value = ev;
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
      if (doneInfo.value) {
        const restarted = await autoRestart();
        // 更新前版本低于当前版本、且没能自动接管重启：旧黑窗口大概率还开着，必须醒目提醒。
        if (!restarted && isLowerVersion(oldVersion, doneInfo.value.version)) {
          remindOldWindowClose(oldVersion, doneInfo.value.version);
        }
      }
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
   * 更新成功后自动重启：后端写重启标记并拉起 启动.bat（新版 bat 会结束旧实例与旧黑窗口），
   * 这里轮询 /api/version 直到「pid 变了且版本是目标版本」再刷新页面。
   * @returns {Promise<boolean>} 是否已接管重启（true 时页面已开始刷新）
   */
  async function autoRestart() {
    restarting.value = true;
    let oldPid = ver.value.pid || null;
    if (oldPid === null) {
      // 页面初次探测版本失败时补一次，拿不到 pid 就退化为只按版本判断
      try {
        const s0 = await getJsonResult('/api/version');
        oldPid = (s0 && s0.pid) || null;
      } catch { /* 忽略 */ }
    }
    let accepted = false;
    try {
      // 旧版本后端没有该接口（404）或响应途中服务被结束，都视为未接管重启
      accepted = (await postJsonResult('/api/update/restart', {})).ok;
    } catch { /* 连接被切断属正常 */ }
    if (!accepted) {
      restarting.value = false;
      return false;
    }
    const target = doneInfo.value && doneInfo.value.version;
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      try {
        const s = await getJsonResult('/api/version');
        if (!s || !s.version) continue;
        if (target && s.version !== target) continue;
        // /api/version 的 version 直接读磁盘 package.json：更新一落盘，旧进程也会报新版本，
        // 所以必须等 pid 变化，否则会提前刷新页面（看起来更新了，实际跑的还是旧后端）。
        // 旧后端没有 pid（oldPid 为 null）无法比对：刷新后由 loadVersion 用「pid 缺失」
        // 判定旧进程仍在运行，并醒目提醒关旧黑窗口。
        if (oldPid !== null && s.pid === oldPid) continue;
        location.reload();
        return true;
      } catch { /* 新进程还没开始监听，拒连是正常的 */ }
    }
    restarting.value = false;
    return false;
  }

  function downloadPackage() {
    if (upd.value.url) window.open(upd.value.url, '_blank');
  }

  // 版本显示与更新检查（静默，失败不打扰）
  onMounted(() => {
    loadVersion();
    checkUpdate();
  });

  return { ver, upd, updateDrawer, checking, applying, steps, doneInfo, restarting, staleBackend, checkUpdate, applyUpdate, openUpdate, downloadPackage };
}
