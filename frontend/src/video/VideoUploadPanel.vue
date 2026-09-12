<!-- 视频上传 · ③ 执行卡片 + 日志面板（展示层）。 -->
<script setup>
import LogPanel from '../components/LogPanel.vue';

defineProps({
  hasRows: { type: Boolean, default: false },
  uploading: { type: Boolean, default: false },
  currentJobId: { type: String, default: '' },
  summary: { type: String, default: '' },
  autoScroll: { type: Boolean, default: true },
  logLines: { type: Array, default: () => [] },
});

const emit = defineEmits(['start', 'cancel', 'clear-log', 'export-result', 'update:autoScroll']);
</script>

<template>
  <el-card shadow="never" class="card">
    <template #header>② 开始批量上传</template>
    <div class="btn-row">
      <el-button type="primary" :disabled="!hasRows" :loading="uploading" @click="emit('start')">
        {{ uploading ? '上传中…' : '开始上传' }}
      </el-button>
      <el-button v-if="uploading" type="danger" plain :disabled="!currentJobId" @click="emit('cancel')">
        取消上传
      </el-button>
      <el-button @click="emit('clear-log')">清空日志</el-button>
      <el-button :disabled="!hasRows" @click="emit('export-result')">导出结果表格</el-button>
      <el-switch
        :model-value="autoScroll"
        inline-prompt
        active-text="自动滚动"
        inactive-text="手动滚动"
        @update:model-value="(v) => emit('update:autoScroll', v)"
      />
    </div>
    <div v-if="summary" class="hint" style="margin-top: 10px">{{ summary }}</div>
    <LogPanel class="log-box" :lines="logLines" height="320px" fixed :auto-scroll="null" />
  </el-card>
</template>

<style scoped>
.btn-row { display: flex; gap: var(--sp-3); margin-top: 6px; flex-wrap: wrap; align-items: center; }
</style>
