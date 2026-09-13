// 控制台日志组合式函数：返回统一结构的 logLines 与 log 函数（配合 components/LogPanel.vue）。
import { ref } from 'vue';

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
