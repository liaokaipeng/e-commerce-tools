// 页面通用组合式函数：控制台日志 / 默认目录设置 / 日志自动滚动 / SSE 流读取
// tiktok / bidding / bidding-cancel / video 四页共用，避免重复实现。
import { ref, watch, nextTick } from 'vue';
import { ElMessage } from 'element-plus';

/** 控制台日志：返回统一结构的 logLines 与 log 函数（配合 components/LogPanel.vue 使用）
 *  @returns {{ logLines: Ref<Array>, log: (msg: string, cls?: string, title?: string) => void,
 *               clear: () => void }} */
export function useLog() {
  const logLines = ref([]);

  function log(msg, cls = 'info', title = '') {
    const time = new Date().toLocaleTimeString('zh-CN', { hour12: false });
    logLines.value.push({ time, msg, cls, title });
  }

  function clear() {
    logLines.value = [];
  }

  return { logLines, log, clear };
}

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

  async function openDir() {
    const d = dir.value.trim();
    if (!d) {
      ElMessage.warning('请先填写保存目录');
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

  return { dir, hasDefault, loadSettings, setDefaultDir, openDir };
}

/** 日志自动滚动：logLines 数量变化时把 logEl 滚到底部；enabled 为 ref 时支持暂停滚动 */
export function useLogScroll(logLines, enabled) {
  const logEl = ref(null);
  watch(
    () => logLines.value.length,
    async () => {
      if (enabled && !enabled.value) return;
      await nextTick();
      if (logEl.value) logEl.value.scrollTop = logEl.value.scrollHeight;
    }
  );
  return { logEl };
}

/** 读取 fetch SSE 响应流，逐条解析 data: 事件并回调 */
export async function readSSE(resp, onEvent) {
  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const parts = buf.split('\n\n');
    buf = parts.pop();
    for (const part of parts) {
      const line = part.split('\n').find((l) => l.startsWith('data: '));
      if (!line) continue;
      try { onEvent(JSON.parse(line.slice(6))); } catch { /* 忽略无法解析的事件 */ }
    }
  }
}