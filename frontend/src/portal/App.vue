<script setup>
import { usePortalTabs } from './usePortalTabs.js';
import { useAppUpdate } from './useAppUpdate.js';
import { GROUP_ORDER } from './tabs.js';
import UpdateDrawer from './UpdateDrawer.vue';

// 各工具各用一个 iframe，首次访问时加载并常驻 DOM。
// 切换 Tab 只改变 display，不重新加载页面，从而保留各 Tab 状态。
const { tabs, active, show, isActive, iframeSrc } = usePortalTabs();
const { ver, upd, updateDrawer, checking, applying, steps, doneInfo, restarting, checkUpdate, applyUpdate, openUpdate, downloadPackage } = useAppUpdate();
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
        <template v-for="g in GROUP_ORDER" :key="g">
          <span class="g-label">{{ g }}</span>
          <a
            v-for="t in tabs.filter((x) => x.group === g)"
            :key="t.key"
            :href="'#/' + t.key"
            :class="{ active: isActive(t.key) }"
            :title="t.sub"
            @click.prevent="show(t.key)"
          >
            {{ t.label }}<small>{{ t.sub }}</small>
          </a>
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
      :restarting="restarting"
      @check="checkUpdate(true)"
      @apply="applyUpdate"
      @download="downloadPackage"
    />
  </div>
</template>

<style scoped src="./portal.css"></style>
