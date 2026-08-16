<!-- 控制台风格日志面板：tiktok / bidding / bidding-cancel / video 四页共用。
     lines: [{ time, cls, msg, title? }]（useToolPage.js 的 useLog 生成），cls 决定行颜色。 -->
<script setup>
import { computed } from 'vue';
import { useLogScroll } from '../composables/useToolPage.js';

const props = defineProps({
  lines: { type: Array, default: () => [] },
  /** 日志区高度（CSS 值），配合 fixed 决定是最大高度还是固定高度 */
  height: { type: String, default: '320px' },
  fixed: { type: Boolean, default: false },
  emptyText: { type: String, default: '等待操作…' },
  /** 可选 ref<boolean>：false 时暂停自动滚动（video 页用） */
  autoScroll: { type: Object, default: null },
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
  background: #10131c;
  color: #c8e1ff;
  font-family: Consolas, "Courier New", monospace;
  font-size: 12.5px;
  line-height: 1.8;
  border-radius: 10px;
  padding: 14px 16px;
  overflow-y: auto;
  word-break: break-all;
  scrollbar-width: thin; /* Firefox 细滚动条 */
  scrollbar-color: #2b3245 transparent;
}
.log-panel::-webkit-scrollbar { width: 8px; height: 8px; }
.log-panel::-webkit-scrollbar-thumb { background: #2b3245; border-radius: 4px; }
.log-panel::-webkit-scrollbar-thumb:hover { background: #3a435c; }
.log-panel::-webkit-scrollbar-track { background: transparent; }
.log-line {
  display: flex;
  gap: 8px;
  word-break: break-all;
}
.log-line + .log-line { margin-top: 3px; }
.log-time { color: #5c6370; flex-shrink: 0; white-space: nowrap; font-variant-numeric: tabular-nums; }
.log-info { color: #b8c0cc; }
.log-warn { color: #ffc95c; }
.log-ok { color: #5fd08a; }
.log-err { color: #ff7b72; }
.log-network { color: #ff9d5c; font-weight: 600; }
.log-title { color: #7d8aff; font-weight: 600; }
.log-empty { color: #8a8a8a; }
</style>
