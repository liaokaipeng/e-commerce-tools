<!-- 控制台风格日志面板：tiktok / bidding / return-whs / video 直接引用，bidding-cancel / hotlisting-cancel 经 PreviewTableCard 内嵌。
     lines: [{ time, cls, msg, title? }]（composables/useLog.js 的 useLog 生成），cls 决定行颜色。 -->
<script setup>
import { computed } from 'vue';
import { useLogScroll } from '../composables/useLogScroll.js';

const props = defineProps({
  lines: { type: Array, default: () => [] },
  /** 日志区高度（CSS 值），配合 fixed 决定是最大高度还是固定高度 */
  height: { type: String, default: '320px' },
  fixed: { type: Boolean, default: false },
  emptyText: { type: String, default: '等待操作…' },
  /** false 时暂停自动滚动（video 页开关用） */
  autoScroll: { type: Boolean, default: true },
});

const { logEl } = useLogScroll(() => props.lines.length, props.autoScroll);

const boxStyle = computed(() => ({
  maxHeight: props.height,
  height: props.fixed ? props.height : undefined,
}));
</script>

<template>
  <div ref="logEl" class="log-panel" :style="boxStyle">
    <div v-for="(l, i) in lines" :key="i" class="log-line">
      <span class="log-time">{{ l.time }}</span>
      <span class="log-text" :class="'log-' + (l.cls || 'info')">
        {{ l.title ? `[${l.title}] ` : '' }}{{ l.msg }}
      </span>
    </div>
    <div v-if="!lines.length" class="log-empty">{{ emptyText }}</div>
  </div>
</template>

<style scoped>
.log-panel {
  background: var(--log-bg);
  color: var(--log-text);
  font-family: var(--font-mono);
  font-size: var(--fs-code);
  line-height: 1.8;
  border-radius: var(--radius-md);
  padding: 14px 16px;
  overflow-y: auto;
  word-break: break-all;
  scrollbar-width: thin; /* Firefox 细滚动条 */
  scrollbar-color: var(--log-scroll) transparent;
}
.log-panel::-webkit-scrollbar { width: 8px; height: 8px; }
.log-panel::-webkit-scrollbar-thumb { background: var(--log-scroll); border-radius: 4px; }
.log-panel::-webkit-scrollbar-thumb:hover { background: var(--log-scroll-hover); }
.log-panel::-webkit-scrollbar-track { background: transparent; }
.log-line {
  display: flex;
  gap: 8px;
  word-break: break-all;
}
.log-line + .log-line { margin-top: 3px; }
.log-time { color: var(--log-time); flex-shrink: 0; white-space: nowrap; font-variant-numeric: tabular-nums; }
.log-info { color: var(--log-info); }
.log-warn { color: var(--log-warn); }
.log-ok { color: var(--log-ok); }
.log-err { color: var(--log-err); }
.log-network { color: var(--log-network); font-weight: 600; }
.log-title { color: var(--log-title); font-weight: 600; }
.log-empty { color: var(--log-empty); }
</style>
