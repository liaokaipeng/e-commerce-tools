// 在场心跳：按需采集调度——仅本页可见时上报「在场」，离开即停。
// 自持窗口/可见性监听与定时器，挂载即生效、卸载即清理。
import { onMounted, onUnmounted } from 'vue';

/** 在场心跳间隔：30s 上报一次「大屏仍可见」，服务端据此按需采集 */
const PRESENCE_HEARTBEAT_MS = 30 * 1000;

export function useMonitorPresence(postJson) {
  let tabActive = window.parent === window; // 直接打开本页（非门户 iframe）时默认视为可见
  let hasParentReply = false;
  let presenceTimer = null;
  let parentTimer = null;

  function sendPresence(active) {
    // 服务暂不可用时忽略，下个心跳重试
    postJson('/api/monitor/presence', { active }).catch(() => { /* 忽略 */ });
  }

  function startPresence() {
    if (presenceTimer) clearInterval(presenceTimer);
    sendPresence(true); // 立即报告在场（服务端会立刻巡检一轮）
    presenceTimer = setInterval(() => sendPresence(true), PRESENCE_HEARTBEAT_MS);
  }

  function stopPresence() {
    if (presenceTimer) { clearInterval(presenceTimer); presenceTimer = null; }
    sendPresence(false); // 离开即停采
  }

  /** 按「门户当前 Tab + 页面可见性」同步在场状态 */
  function syncPresence() {
    if (tabActive && document.visibilityState !== 'hidden') startPresence();
    else stopPresence();
  }

  function onParentMessage(ev) {
    if (!ev || !ev.data) return;
    if (ev.data.type === 'portal-tab') {
      hasParentReply = true;
      tabActive = ev.data.key === 'monitor';
      syncPresence();
    }
  }

  function onVisibilityChange() {
    syncPresence();
  }

  onMounted(() => {
    // 门户 iframe 内先询问当前激活 Tab（避免「刚打开又立刻切走」误报在场）；
    // 没有父窗口（直接访问本页）则立即视为在场
    window.addEventListener('message', onParentMessage);
    document.addEventListener('visibilitychange', onVisibilityChange);
    if (window.parent !== window) {
      try { window.parent.postMessage({ type: 'monitor-ready' }, location.origin || '*'); } catch { /* 忽略 */ }
      parentTimer = setTimeout(() => {
        if (!hasParentReply) { tabActive = true; syncPresence(); }
      }, 1500);
    } else {
      syncPresence();
    }
  });

  onUnmounted(() => {
    stopPresence();
    if (parentTimer) clearTimeout(parentTimer);
    window.removeEventListener('message', onParentMessage);
    document.removeEventListener('visibilitychange', onVisibilityChange);
  });

  return { startPresence, stopPresence, syncPresence };
}
