// 门户页 Tab 与 iframe 常驻逻辑：切换 Tab 只改 visibility，首次激活才赋 src。
// 地址栏以 hash（#/<tab key>）同步当前 Tab：菜单项即链接，可收藏、可前进后退。
import { ref, reactive, onMounted, onUnmounted } from 'vue';
import { TABS } from './tabs.js';

const DEFAULT_KEY = 'bidding';

/** 从 location.hash 解析 Tab key（兼容 #/bidding 与 #/bidding/），非法值返回 null */
function keyFromHash() {
  const key = location.hash.replace(/^#\/?/, '').replace(/\/+$/, '');
  return TABS.some((t) => t.key === key) ? key : null;
}

export function usePortalTabs() {
  const active = ref(DEFAULT_KEY);
  // 用 reactive 包裹，add/delete 会触发视图更新（否则首次挂载后 iframe src 不会刷新）
  const loaded = reactive(new Set());

  function show(key, { pushHistory = true } = {}) {
    const tab = TABS.find((t) => t.key === key);
    if (!tab) return;
    active.value = key;
    if (!loaded.has(key)) {
      loaded.add(key);
    }
    // 点击菜单时把 hash 写进地址栏（pushHistory=false 用于前进后退，避免重复入栈）；
    // 初始挂载与纠正非法 hash 走 replaceState，不堆历史记录
    if (keyFromHash() !== key) {
      if (pushHistory) history.pushState({ tab: key }, '', `#/${key}`);
      else history.replaceState({ tab: key }, '', `#/${key}`);
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

  /** 浏览器前进/后退或用户手改地址栏后，按 hash 激活对应 Tab；非法 hash 纠正回当前 Tab */
  function onPopState() {
    const key = keyFromHash();
    if (key) {
      if (key !== active.value) {
        show(key, { pushHistory: false });
      }
    } else {
      // replaceState 不会再触发 hashchange，不会死循环
      history.replaceState({ tab: active.value }, '', `#/${active.value}`);
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

  // 首次打开：有合法 hash 就激活对应 Tab，否则回落默认 Tab；两种情况都把地址栏规范成 #/<key>
  onMounted(() => {
    const key = keyFromHash();
    if (key) {
      active.value = key;
      loaded.add(key);
      if (location.hash !== `#/${key}`) {
        history.replaceState({ tab: key }, '', `#/${key}`);
      }
    } else {
      active.value = DEFAULT_KEY;
      loaded.add(DEFAULT_KEY);
      history.replaceState({ tab: DEFAULT_KEY }, '', `#/${DEFAULT_KEY}`);
    }
    notifyTabs(active.value);
    window.addEventListener('popstate', onPopState);
    window.addEventListener('hashchange', onPopState);
  });

  onUnmounted(() => {
    window.removeEventListener('popstate', onPopState);
    window.removeEventListener('hashchange', onPopState);
  });

  return { tabs: TABS, active, show, isActive, iframeSrc };
}
