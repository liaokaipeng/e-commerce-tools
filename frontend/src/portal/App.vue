<script setup>
import { usePortalTabs } from './usePortalTabs.js';
import { useAppUpdate } from './useAppUpdate.js';
import UpdateDrawer from './UpdateDrawer.vue';

// 各工具各用一个 iframe，首次访问时加载并常驻 DOM。
// 切换 Tab 只改变 display，不重新加载页面，从而保留各 Tab 状态。
const { tabs, active, show, isActive, iframeSrc } = usePortalTabs();
const { ver, upd, updateDrawer, checking, applying, steps, doneInfo, checkUpdate, applyUpdate, openUpdate, downloadPackage } = useAppUpdate();
</script>

<template>
  <div class="portal">
    <aside class="sidebar">
      <div class="brand">
        <span class="brand-text">
          <b>电商工具箱</b>
        </span>
      </div>
      <nav>
        <template v-for="g in ['Shopee', 'TikTok']" :key="g">
          <span class="g-label">{{ g }}</span>
          <button
            v-for="t in tabs.filter((x) => x.group === g)"
            :key="t.key"
            :class="{ active: isActive(t.key) }"
            :title="t.sub"
            @click="show(t.key)"
          >
            {{ t.label }}<small>{{ t.sub }}</small>
          </button>
        </template>
      </nav>
      <div class="ver-bar" title="版本与更新" @click="openUpdate">
        <span class="ver-text">v{{ ver.version || '…' }}</span>
        <span v-if="upd.hasUpdate" class="ver-badge">新 v{{ upd.latest }}</span>
        <span v-else-if="upd.error" class="ver-warn" title="更新检查失败">检查失败</span>
      </div>
    </aside>
    <div class="frame-wrap">
      <iframe
        v-for="t in tabs"
        :key="t.key"
        :class="{ active: isActive(t.key) }"
        :title="t.label"
        :src="iframeSrc(t)"
      ></iframe>
    </div>

    <UpdateDrawer
      v-model:updateDrawer="updateDrawer"
      :ver="ver"
      :upd="upd"
      :checking="checking"
      :applying="applying"
      :steps="steps"
      :done-info="doneInfo"
      @check="checkUpdate(true)"
      @apply="applyUpdate"
      @download="downloadPackage"
    />
  </div>
</template>

<style scoped>
* { box-sizing: border-box; margin: 0; padding: 0; }
.portal {
  /* 深色侧栏令牌：与监控大屏（monitor.css 的 --d-*）同源，两处深色观感一致 */
  --p-bg: #f4f6fb;          /* 内容区（iframe 之外的留白） */
  --p-sidebar: #111527;     /* 与监控大屏顶栏一致 */
  --p-border: #1e2440;
  --p-text-1: #eef1f8;      /* 标题 */
  --p-text-2: #d3d9e8;      /* 正文 / 菜单项 */
  --p-text-3: #99a1b8;      /* 分组标签 / 次要说明 */
  --p-brand: #ee4d2d;
  --p-hover: rgba(255, 255, 255, 0.16);
  --p-rest: rgba(255, 255, 255, 0.08);
  --p-radius-sm: 8px;
  --p-radius-md: 10px;

  font-family: "Microsoft YaHei", "PingFang SC", -apple-system, "Segoe UI", "Helvetica Neue", Arial, sans-serif;
  font-size: 14px;
  line-height: 1.5;
  background: var(--p-bg);
  color: #23262f;
  height: 100vh;
  display: flex;
  flex-direction: row;
}
.sidebar {
  flex: none;
  width: 208px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  overflow-y: auto; /* 菜单过多时侧栏纵向滚动 */
  background: var(--p-sidebar);
  border-right: 1px solid var(--p-border);
  color: var(--p-text-2);
  padding: 16px 14px;
  /* 深色侧栏的原生滚动条也要跟着变深，否则 Windows 上会露出一条浅灰滚动条 */
  color-scheme: dark;
  scrollbar-width: thin;
  scrollbar-color: #2f3a5c transparent;
}
.sidebar::-webkit-scrollbar { width: 10px; }
.sidebar::-webkit-scrollbar-track { background: transparent; }
.sidebar::-webkit-scrollbar-thumb {
  background: #2f3a5c;
  background-clip: padding-box;
  border: 2px solid transparent;
  border-radius: 999px;
}
.sidebar::-webkit-scrollbar-thumb:hover { background: #3d4a72; background-clip: padding-box; }
.brand {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: none;
  padding: 0 4px 12px;
  border-bottom: 1px solid var(--p-border);
}
.logo {
  width: 34px;
  height: 34px;
  background: var(--p-brand);
  border-radius: var(--p-radius-md);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  font-weight: 700;
  color: #fff;
  box-shadow: 0 2px 8px rgba(238, 77, 45, 0.45);
}
.brand b { font-size: 16px; font-weight: 600; color: var(--p-text-1); display: block; line-height: 1.2; }
.brand small {
  display: block;
  font-size: 11px;
  font-weight: 400;
  color: var(--p-text-3);
  line-height: 1.2;
}
nav {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.g-label {
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 1px;
  color: var(--p-text-3);
  margin-top: 6px;
  white-space: nowrap;
}
.g-label:first-child { margin-top: 0; }
nav button {
  border: none;
  background: var(--p-rest);
  color: var(--p-text-2);
  padding: 8px 12px;
  border-radius: var(--p-radius-sm);
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: background-color 0.15s, color 0.15s, transform 0.15s, box-shadow 0.15s;
  font-family: inherit;
  white-space: nowrap;
  text-align: left;
}
nav button:hover { background: var(--p-hover); color: #fff; }
nav button.active {
  background: var(--p-brand);
  color: #fff;
  box-shadow: 0 2px 10px rgba(238, 77, 45, 0.5);
  transform: translateX(2px);
}
nav button small {
  display: block;
  font-size: 11px;
  font-weight: 400;
  color: var(--p-text-3);
  transition: color 0.15s;
}
nav button.active small, nav button:hover small { color: rgba(255, 255, 255, 0.82); }
.frame-wrap { flex: 1; position: relative; }

/* ============ 侧栏底部：版本与更新入口 ============ */
.ver-bar {
  margin-top: auto;
  flex: none;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-radius: var(--p-radius-sm);
  background: var(--p-rest);
  color: var(--p-text-3);
  font-size: 12px;
  cursor: pointer;
  transition: background-color 0.15s, color 0.15s;
  white-space: nowrap;
}
.ver-bar:hover { background: var(--p-hover); color: var(--p-text-2); }
.ver-text { font-variant-numeric: tabular-nums; }
.ver-badge {
  background: var(--p-brand);
  color: #fff;
  font-size: 11px;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 999px;
}
.ver-warn { color: #e6a23c; }
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
  .brand-text b { font-size: 12px; }
  .sidebar { width: 64px; padding: 12px 8px; }
  nav button { padding: 8px; font-size: 12px; }
  nav button small, .g-label { display: none; }
}
</style>