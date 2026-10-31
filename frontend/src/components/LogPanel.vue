<!-- 控制台风格日志面板：tiktok / bidding / return-whs / video 直接引用，bidding-cancel / hotlisting-cancel 经 PreviewTableCard 内嵌。
     lines: [{ time, cls, msg, title? }]（composables/useLog.js 的 useLog 生成），cls 决定行颜色。
     右上角内置「自动滚动」开关（scrollToggle=false 可隐藏），各页不再自备开关。 -->
<script setup>
import { ref, computed } from 'vue';
import { useLogScroll } from '../composables/useLogScroll.js';

const props = defineProps({
  lines: { type: Array, default: () => [] },
  /** 日志区高度（CSS 值），配合 fixed 决定是最大高度还是固定高度 */
  height: { type: String, default: '280px' },
  fixed: { type: Boolean, default: false },
  emptyText: { type: String, default: '等待操作…' },
  /** 自动滚动的初始状态（开关由面板内部维护） */
  autoScroll: { type: Boolean, default: true },
  /** 是否显示右上角「自动滚动」开关 */
  scrollToggle: { type: Boolean, default: true },
});

// 本地开关：初始值取 prop，用户点击后只影响本面板
const autoScrollOn = ref(props.autoScroll);
const { logEl } = useLogScroll(() => props.lines.length, autoScrollOn);

const boxStyle = computed(() => ({
  maxHeight: props.height,
  height: props.fixed ? props.height : undefined,
}));
</script>

<template>
  <div class="log-panel-wrap">
    <div ref="logEl" class="log-panel" :style="boxStyle">
      <div v-for="(l, i) in lines" :key="i" class="log-line">
        <span class="log-time">{{ l.time }}</span>
        <span class="log-text" :class="'log-' + (l.cls || 'info')">
          {{ l.title ? `[${l.title}] ` : '' }}{{ l.msg }}
        </span>
      </div>
      <div v-if="!lines.length" class="log-empty">{{ emptyText }}</div>
    </div>
    <button
      v-if="scrollToggle"
      type="button"
      class="log-autoscroll"
      :class="{ on: autoScrollOn }"
      :title="autoScrollOn ? '自动滚动已开启，点击暂停' : '自动滚动已暂停，点击开启'"
      @click="autoScrollOn = !autoScrollOn"
    >
      <span class="log-autoscroll-dot"></span>自动滚动
    </button>
  </div>
</template>

<style scoped>
.log-panel-wrap { position: relative; }
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

/* 右上角自动滚动开关（悬浮在深色面板上，不随内容滚动） */
.log-autoscroll {
  position: absolute;
  top: 8px;
  right: 10px;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  border: none;
  cursor: pointer;
  font-family: inherit;
  font-size: 11px;
  color: var(--log-time);
  background: rgba(255, 255, 255, 0.07);
  padding: 3px 9px;
  border-radius: 999px;
  transition: background-color 0.15s, color 0.15s;
}
.log-autoscroll:hover { background: rgba(255, 255, 255, 0.14); color: var(--log-info); }
.log-autoscroll-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #5a6172;
  transition: background-color 0.15s;
}
.log-autoscroll.on .log-autoscroll-dot { background: var(--log-ok); }
</style>
