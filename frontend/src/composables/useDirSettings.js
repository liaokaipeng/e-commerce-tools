// 保存目录设置组合式函数：读取 / 设置默认目录、打开目录。
import { ref } from 'vue';
import { ElMessage } from 'element-plus';

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
      const r = await fetch('/api/settings');
      const s = await r.json();
      const d = s.defaults && s.defaults[tool];
      if (d) {
        dir.value = d;
        hasDefault.value = true;
      }
    } catch {}
  }

  async function setDefaultDir(d) {
    try {
      const r = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tool, dir: d }),
      });
      const res = await r.json();
      if (res.ok) {
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
      const r = await fetch('/api/open-dir', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dir: d }),
      });
      const res = await r.json();
      if (!res.ok) {
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

  return { dir, hasDefault, loadSettings, setDefaultDir, openDir, openPath };
}
