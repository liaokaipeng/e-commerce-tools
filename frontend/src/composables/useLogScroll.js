// 日志自动滚动组合式函数：日志条数变化时把容器滚到底部，支持暂停。
import { ref, watch, nextTick } from 'vue';

/** 日志自动滚动：日志条数变化时把 logEl 滚到底部；enabled 为 ref 时支持暂停滚动
 *  @param {() => number} countOf 返回当前日志条数的 getter（如 () => props.lines.length）
 *  @param {import('vue').Ref<boolean>|null} [enabled] 值为 ref 且为 false 时暂停自动滚动
 *  @returns {{ logEl: import('vue').Ref<HTMLElement|null> }} 绑定到日志容器的 ref */
export function useLogScroll(countOf, enabled) {
  const logEl = ref(null);
  watch(countOf, async () => {
    if (enabled && !enabled.value) return;
    await nextTick();
    if (logEl.value) logEl.value.scrollTop = logEl.value.scrollHeight;
  });
  return { logEl };
}
