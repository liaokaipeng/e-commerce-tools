<script setup>
import { ref, onUnmounted } from 'vue';
import { GoodsFilled } from '@element-plus/icons-vue';
import { usePortalTabs } from './usePortalTabs.js';
import { useAppUpdate } from './useAppUpdate.js';
import { GROUP_ORDER } from './tabs.js';
import UpdateDrawer from './UpdateDrawer.vue';

// 各工具各用一个 iframe，首次访问（或侧栏 hover 预载）时加载并常驻 DOM。
// 切换 Tab 只改变透明度，不重新加载页面，从而保留各 Tab 状态；
// iframe 未触发 load 前显示骨架占位，消除首次切换的白屏。
const { tabs, active, show, isActive, iframeSrc, ready, markReady, preload } = usePortalTabs();
const { ver, upd, updateDrawer, checking, applying, steps, doneInfo, restarting, checkUpdate, applyUpdate, openUpdate, downloadPackage } = useAppUpdate();

// ---------- 侧栏 hover 意图预载：悬停 600ms 才赋 src，划过不触发加载 ----------
// （preload 内部自带「已加载则跳过」守卫，这里只需挡掉已就绪的 Tab）
const hoverTimers = new Map();
function onEnter(key) {
  if (ready.has(key)) return;
  hoverTimers.set(key, setTimeout(() => preload(key), 600));
}
function onLeave(key) {
  const t = hoverTimers.get(key);
  if (t) { clearTimeout(t); hoverTimers.delete(key); }
}
onUnmounted(() => { for (const t of hoverTimers.values()) clearTimeout(t); });
</script>

<template>
  <div class="portal">
    <aside class="sidebar">
      <div class="brand">
        <span class="logo"><el-icon><GoodsFilled /></el-icon></span>
        <span class="brand-text">
          <b>电商工具箱</b>
          <small>本地电商工具集</small>
        </span>
      </div>
      <nav>
        <template v-for="g in GROUP_ORDER.filter((name) => tabs.some((t) => t.group === name))" :key="g">
          <span class="g-label">{{ g }}</span>
          <a
            v-for="t in tabs.filter((x) => x.group === g)"
            :key="t.key"
            :href="'#/' + t.key"
            :class="{ active: isActive(t.key) }"
            :title="t.sub"
            @click.prevent="show(t.key)"
            @mouseenter="onEnter(t.key)"
            @mouseleave="onLeave(t.key)"
          >
            <el-icon class="nav-ico"><component :is="t.icon" /></el-icon>
            <span class="nav-text">
              {{ t.label }}
              <small>{{ t.sub }}</small>
            </span>
          </a>
        </template>
      </nav>
      <div class="ver-card" title="版本与更新" @click="openUpdate">
        <div class="ver-row">
          <span class="ver-label">当前版本</span>
          <span class="ver-text">v{{ ver.version || '…' }}</span>
        </div>
        <div class="ver-status">
          <span v-if="upd.hasUpdate" class="ver-badge">新版本 v{{ upd.latest }} · 点击更新</span>
          <span v-else-if="upd.error" class="ver-warn">更新检查失败，点击重试</span>
          <span v-else-if="checking" class="ver-dim">正在检查更新…</span>
          <span v-else class="ver-dim">点击查看版本与更新</span>
        </div>
      </div>
    </aside>
    <div class="frame-wrap">
      <div v-for="t in tabs" :key="t.key" class="frame-slot" :class="{ active: isActive(t.key) }">
        <iframe v-if="iframeSrc(t)" :src="t.src" :title="t.label" @load="markReady(t.key)"></iframe>
        <div v-if="!ready.has(t.key)" class="frame-loading">
          <div class="frame-loading-box">
            <span class="frame-loading-logo"><el-icon><GoodsFilled /></el-icon></span>
            <span class="frame-loading-text">正在加载「{{ t.label }}」…</span>
          </div>
        </div>
      </div>
    </div>

    <UpdateDrawer
      v-model:updateDrawer="updateDrawer"
      :ver="ver"
      :upd="upd"
      :checking="checking"
      :applying="applying"
      :steps="steps"
      :done-info="doneInfo"
      :restarting="restarting"
      @check="checkUpdate(true)"
      @apply="applyUpdate"
      @download="downloadPackage"
    />
  </div>
</template>

<style scoped src="./portal.css"></style>
