// 日志自动滚动组合式函数：日志条数变化时把容器滚到底部，支持暂停。
import { ref, watch, nextTick } from 'vue';

/** 日志自动滚动：日志条数变化时把 logEl 滚到底部。
 *  @param {() => number} countOf 返回当前日志条数的 getter（如 () => props.lines.length）
 *  @param {boolean|import('vue').Ref<boolean>|null} [enabled] false（或 ref 值为 false）时暂停自动滚动；null/undefined 视为启用
 *  @returns {{ logEl: import('vue').Ref<HTMLElement|null> }} 绑定到日志容器的 ref */
export function useLogScroll(countOf, enabled) {
  const logEl = ref(null);
  watch(countOf, async () => {
    const on = enabled === null || enabled === undefined ? true : (typeof enabled === 'object' ? enabled.value : enabled);
    if (!on) return;
    await nextTick();
    if (logEl.value) logEl.value.scrollTop = logEl.value.scrollHeight;
  });
  return { logEl };
}
