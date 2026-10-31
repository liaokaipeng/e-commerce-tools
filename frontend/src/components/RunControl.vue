<!-- 统一执行控制条：主按钮（普通/危险两态）+ 暂停/继续/取消 + 可视化进度条 + 状态提示。
     进度数据来自 useBatchJob 的 progress（{ done, ok, fail, total }），
     或页面自行组织的同构对象（video / bidding / openapi 批量刷新）。
     日志面板不内置于本组件——各页按自身布局放置 LogPanel。 -->
<script setup>
import { computed } from 'vue';

const props = defineProps({
  actionText: { type: String, default: '开始执行' },
  runningText: { type: String, default: '执行中…' },
  running: { type: Boolean, default: false },
  canRun: { type: Boolean, default: false },
  /** 危险操作主按钮（红色实心）；默认品牌色 */
  danger: { type: Boolean, default: false },
  /** 是否提供暂停/继续（无暂停能力的任务如视频上传传 false） */
  pausable: { type: Boolean, default: true },
  jobId: { type: String, default: '' },
  paused: { type: Boolean, default: false },
  pausing: { type: Boolean, default: false },
  cancellable: { type: Boolean, default: true },
  /** 静止时常驻提示（如危险提示 / 运行说明）；type 决定配色：info | warning | danger */
  tip: { type: String, default: '' },
  tipType: { type: String, default: 'info' },
  /** 暂停时替换 tip 显示的提示 */
  pausedTip: { type: String, default: '已暂停：不再发起请求，点击「继续」恢复。' },
  /** 进度 { done, total, fail }；running 且 total>0 时显示进度条 */
  progress: { type: Object, default: null },
});

const emit = defineEmits(['run', 'pause', 'cancel']);

const percent = computed(() => {
  const p = props.progress;
  if (!p || !p.total) return 0;
  return Math.min(100, Math.round((p.done / p.total) * 100));
});
</script>

<template>
  <div class="run-control">
    <div class="actions">
      <el-button
        :type="danger ? 'danger' : 'primary'"
        size="large"
        :disabled="!canRun"
        :loading="running && !paused"
        @click="emit('run')"
      >
        {{ running ? runningText : actionText }}
      </el-button>
      <el-button
        v-if="pausable && running && jobId"
        size="large"
        :type="paused ? 'success' : 'warning'"
        :loading="pausing"
        @click="emit('pause')"
      >
        {{ paused ? '继续' : '暂停' }}
      </el-button>
      <el-button v-if="running && jobId && cancellable" size="large" type="danger" plain @click="emit('cancel')">
        取消任务
      </el-button>
      <slot name="extra-actions" />
      <span v-if="running && paused" class="run-tip run-tip-warning">{{ pausedTip }}</span>
      <span v-else-if="tip" class="run-tip" :class="'run-tip-' + tipType">{{ tip }}</span>
    </div>
    <div v-if="running && progress && progress.total > 0" class="run-progress">
      <el-progress class="run-progress-bar" :percentage="percent" :stroke-width="8" :show-text="false" />
      <span class="run-progress-text">
        {{ progress.done }}/{{ progress.total }}<template v-if="progress.fail"> · <b class="run-fail">失败 {{ progress.fail }}</b></template>
      </span>
    </div>
  </div>
</template>

<style scoped>
.run-progress {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: var(--sp-3);
}
.run-progress-bar { flex: 1; }
.run-progress-text {
  font-size: var(--fs-sm);
  color: var(--text-2);
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}
.run-fail { color: var(--danger); font-weight: 600; }
.run-tip {
  font-size: var(--fs-sm);
  flex: 1;
  min-width: 220px;
  line-height: 1.5;
}
.run-tip-info { color: var(--text-3); }
.run-tip-warning { color: var(--warning); }
.run-tip-danger { color: var(--danger); }
</style>
