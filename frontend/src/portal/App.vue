<script setup>
import { ref, reactive, onMounted } from 'vue';

// 各工具各用一个 iframe，首次访问时加载并常驻 DOM。
// 切换 Tab 只改变 display，不重新加载页面，从而保留各 Tab 状态。
// 视频上传按站点拆分为两个入口（跨境 / 本土），共用 /video/ 页面，经 ?mode=cn|ph 区分站点。
const tabs = [
  { key: 'bidding', label: '竞价导出', sub: '获胜数据 → Excel', group: 'Shopee', src: '/bidding/' },
  { key: 'bidding-cancel', label: '取消竞价', sub: '批量撤销待改进竞价', group: 'Shopee', src: '/bidding-cancel/' },
  { key: 'video-cn', label: '跨境视频上传', sub: '批量上传并关联商品', group: 'Shopee', src: '/video/?mode=cn' },
  { key: 'video-ph', label: '本土视频上传', sub: '菲律宾站点批量上传', group: 'Shopee', src: '/video/?mode=ph' },
  { key: 'openapi', label: '开放平台', sub: 'App 授权与 Token 管理', group: 'Shopee', src: '/openapi/' },
  { key: 'monitor', label: '监控大屏', sub: '多店巡检三级告警', group: 'Shopee', src: '/monitor/' },
  { key: 'tiktok', label: '视频下载', sub: '批量无水印下载', group: 'TikTok', src: '/tiktok/' },
];

const active = ref('bidding');
// 用 reactive 包裹，add/delete 会触发视图更新（否则首次挂载后 iframe src 不会刷新）
const loaded = reactive(new Set());

function show(key) {
  active.value = key;
  const tab = tabs.find((t) => t.key === key);
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

// 首次打开即加载默认 Tab（竞价导出），否则其 iframe 无 src 显示空白
onMounted(() => {
  show(active.value);
  // 子页面（如监控大屏）可通过 parent.postMessage 请求切换 Tab；
  // 监控大屏加载完成后发 monitor-ready 询问当前激活 Tab（用于按需采集启停）
  window.addEventListener('message', (ev) => {
    const d = ev.data;
    if (d && d.type === 'switch-tab' && tabs.some((t) => t.key === d.key)) {
      show(d.key);
    } else if (d && d.type === 'monitor-ready') {
      try {
        ev.source && ev.source.postMessage({ type: 'portal-tab', key: active.value }, location.origin);
      } catch { /* 忽略 */ }
    }
  });
});
</script>

<template>
  <div class="portal">
    <header class="topbar">
      <div class="brand">
        <b>工具合集</b>
      </div>
      <nav>
        <template v-for="g in ['Shopee', 'TikTok']" :key="g">
          <span class="g-label">{{ g }}</span>
          <button
            v-for="t in tabs.filter((x) => x.group === g)"
            :key="t.key"
            :class="{ active: isActive(t.key) }"
            @click="show(t.key)"
          >
            {{ t.label }}<small>{{ t.sub }}</small>
          </button>
        </template>
      </nav>
    </header>
    <div class="frame-wrap">
      <iframe
        v-for="t in tabs"
        :key="t.key"
        :class="{ active: isActive(t.key) }"
        :src="iframeSrc(t)"
      ></iframe>
    </div>
  </div>
</template>

<style scoped>
* { box-sizing: border-box; margin: 0; padding: 0; }
.portal {
  font-family: "Microsoft YaHei", "PingFang SC", -apple-system, "Segoe UI", sans-serif;
  background: #f4f6fb;
  color: #23262f;
  height: 100vh;
  display: flex;
  flex-direction: column;
}
.topbar {
  display: flex;
  align-items: center;
  gap: 18px;
  flex-wrap: wrap;
  background: #1a1a2e;
  color: #fff;
  padding: 12px 24px;
}
.brand {
  display: flex;
  align-items: center;
  gap: 10px;
}
.logo {
  width: 34px;
  height: 34px;
  background: #ee4d2d;
  border-radius: 9px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  font-weight: 700;
}
.brand b { font-size: 16px; }
nav {
  display: flex;
  gap: 18px;
  flex: 1;
  flex-wrap: wrap;
  align-items: center;
}
.g-label {
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 1px;
  color: #8f95a8;
  margin-right: 2px;
  white-space: nowrap;
}
nav button {
  border: none;
  background: rgba(255, 255, 255, 0.08);
  color: #cfd3e0;
  padding: 9px 18px;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s;
  font-family: inherit;
}
nav button:hover { background: rgba(255, 255, 255, 0.16); }
nav button.active { background: #ee4d2d; color: #fff; }
nav button small {
  display: block;
  font-size: 11px;
  font-weight: 400;
  opacity: 0.75;
}
.frame-wrap { flex: 1; position: relative; }
iframe {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  border: none;
  background: #fff;
  visibility: hidden;
}
iframe.active { visibility: visible; }
@media (max-width: 640px) {
  .brand b { display: none; }
}
</style>