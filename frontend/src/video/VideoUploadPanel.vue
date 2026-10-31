<!-- 视频上传 · ③ 执行卡片 + 日志面板（展示层）。
     执行控制（含进度条）统一走 RunControl；自动滚动开关内置于 LogPanel。 -->
<script setup>
import StepCard from '../components/StepCard.vue';
import RunControl from '../components/RunControl.vue';
import LogPanel from '../components/LogPanel.vue';

defineProps({
  hasRows: { type: Boolean, default: false },
  uploading: { type: Boolean, default: false },
  currentJobId: { type: String, default: '' },
  summary: { type: String, default: '' },
  logLines: { type: Array, default: () => [] },
  /** { done, total, fail }，来自 useVideoUpload */
  progress: { type: Object, default: null },
});

const emit = defineEmits(['start', 'cancel', 'clear-log', 'export-result']);
</script>

<template>
  <StepCard :index="3" title="开始批量上传">
    <RunControl
      action-text="开始上传"
      running-text="上传中…"
      :running="uploading"
      :can-run="hasRows"
      :job-id="currentJobId"
      :pausable="false"
      :progress="uploading ? progress : null"
      tip="上传完成（含取消）后会自动导出带【状态】列的结果表格。"
      @run="emit('start')"
      @cancel="emit('cancel')"
    >
      <template #extra-actions>
        <el-button size="large" @click="emit('clear-log')">清空日志</el-button>
        <el-button size="large" :disabled="!hasRows" @click="emit('export-result')">导出结果表格</el-button>
      </template>
    </RunControl>
    <div v-if="summary" class="hint summary">{{ summary }}</div>
    <LogPanel class="log-box" :lines="logLines" height="280px" fixed />
  </StepCard>
</template>

<style scoped>
.summary { margin-top: var(--sp-2); }
</style>
