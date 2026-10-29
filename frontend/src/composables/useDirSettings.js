// 保存目录设置组合式函数：读取 / 设置默认目录、打开目录。
import { ref } from 'vue';
import { ElMessage } from 'element-plus';
import { getJsonResult, postJsonResult } from './api.js';
import { confirmDanger } from './confirmDanger.js';

/**
 * 保存目录相关（读取/设置默认目录、打开目录）
 * @param {string} tool 工具标识（tiktok | bidding）
 * @param {(msg: string, cls?: string) => void} log 页面日志函数
 */
export function useDirSettings(tool, log = () => {}) {
  const dir = ref('');
  const hasDefault = ref(false);

  async function loadSettings() {
    try {
      const s = await getJsonResult('/api/settings');
      const d = s.defaults && s.defaults[tool];
      if (d) {
        dir.value = d;
        hasDefault.value = true;
      }
    } catch {}
  }

  async function setDefaultDir(d) {
    try {
      const { ok, data: res } = await postJsonResult('/api/settings', { tool, dir: d });
      if (ok) {
        hasDefault.value = true;
        log('已设为默认目录：' + d, 'ok');
        return true;
      }
      log('设置默认目录失败：' + (res.message || '未知错误'), 'err');
      return false;
    } catch {
      log('设置默认目录失败：连接服务失败', 'err');
      return false;
    }
  }

  /** 在资源管理器里打开任意目录（不存在则先创建）；emptyMsg 是路径为空时的提示 */
  async function openPath(p, emptyMsg = '请先填写目录') {
    const d = String(p || '').trim();
    if (!d) {
      ElMessage.warning(emptyMsg);
      return;
    }
    try {
      const { ok, data: res } = await postJsonResult('/api/open-dir', { dir: d });
      if (!ok) {
        ElMessage.warning('无法打开目录：' + res.message);
        log('无法打开目录：' + res.message, 'err');
      }
    } catch {
      ElMessage.warning('无法打开目录：连接服务失败');
      log('无法打开目录：连接服务失败', 'err');
    }
  }

  /** 打开本工具当前填写的目录 */
  async function openDir() {
    return openPath(dir.value, '请先填写保存目录');
  }

  /** 执行导出/下载前询问「是否设为默认目录」：尚未设过时弹确认，用户取消则静默继续 */
  async function ensureDefaultDir(d) {
    if (hasDefault.value) return;
    const ok = await confirmDanger({
      message: `是否将「${d}」设为默认目录？下次打开会自动使用该目录。`,
      title: '默认目录',
      confirmText: '设为默认',
      cancelText: '暂不',
      type: 'info',
      danger: false,
    });
    if (ok) await setDefaultDir(d);
  }

  return { dir, hasDefault, loadSettings, setDefaultDir, ensureDefaultDir, openDir };
}
