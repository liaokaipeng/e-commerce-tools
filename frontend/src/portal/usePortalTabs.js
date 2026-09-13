// 门户页 Tab 与 iframe 常驻逻辑：切换 Tab 只改 visibility，首次激活才赋 src。
import { ref, reactive, onMounted } from 'vue';
import { TABS } from './tabs.js';

export function usePortalTabs() {
  const active = ref('bidding');
  // 用 reactive 包裹，add/delete 会触发视图更新（否则首次挂载后 iframe src 不会刷新）
  const loaded = reactive(new Set());

  function show(key) {
    active.value = key;
    const tab = TABS.find((t) => t.key === key);
    if (tab && !loaded.has(key)) {
      loaded.add(key);
    }
    notifyTabs(key);
  }

  /** 通知所有已加载 iframe 当前激活的 Tab（监控大屏据此启停按需采集） */
  function notifyTabs(key) {
    for (const f of Array.from(document.querySelectorAll('iframe'))) {
      try {
        f.contentWindow && f.contentWindow.postMessage({ type: 'portal-tab', key }, location.origin);
      } catch { /* 忽略跨源 iframe */ }
    }
  }

  function isActive(key) {
    return active.value === key;
  }

  function iframeSrc(tab) {
    // 仅当该 Tab 被激活时才真正赋值 src，避免一次性加载全部页面
    return loaded.has(tab.key) ? tab.src : undefined;
  }

  function onMessage(ev) {
    const d = ev.data;
    // 子页面（如监控大屏）可通过 parent.postMessage 请求切换 Tab；
    // 监控大屏加载完成后发 monitor-ready 询问当前激活 Tab（用于按需采集启停）
    if (d && d.type === 'switch-tab' && TABS.some((t) => t.key === d.key)) {
      show(d.key);
    } else if (d && d.type === 'monitor-ready') {
      try {
        ev.source && ev.source.postMessage({ type: 'portal-tab', key: active.value }, location.origin);
      } catch { /* 忽略 */ }
    }
  }

  // 首次打开即加载默认 Tab（竞价导出），否则其 iframe 无 src 显示空白
  onMounted(() => {
    show(active.value);
    window.addEventListener('message', onMessage);
  });

  return { tabs: TABS, active, show, isActive, iframeSrc };
}
