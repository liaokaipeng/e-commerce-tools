<!-- 预览表格卡片：StepCard 骨架 + 展开行明细 + 店铺/数量/状态列 + 统一执行控制条
     （RunControl：含进度条与暂停/继续/取消）。
     bidding-cancel 与 hotlisting-cancel 两页同源复用；两页的差异（是否有 SPU 列、明细列内容）
     通过 extra-columns / #detail 插槽注入。 -->
<script setup>
import StepCard from './StepCard.vue';
import RunControl from './RunControl.vue';
import LogPanel from './LogPanel.vue';

defineProps({
  index: { type: [Number, String], default: '' },
  title: { type: String, required: true },
  /** 卡片头部右侧徽章（如「待改进竞价共 12 条」） */
  badge: { type: String, default: '' },
  rows: { type: Array, default: () => [] },
  /** 行唯一键：(row) => string */
  rowKeyOf: { type: Function, required: true },
  /** 数量列标题与取值 */
  countLabel: { type: String, default: '数量' },
  countOf: { type: Function, required: true },
  /** 执行区（透传 RunControl） */
  actionText: { type: String, default: '开始执行' },
  runningText: { type: String, default: '执行中…' },
  running: { type: Boolean, default: false },
  canRun: { type: Boolean, default: false },
  /** 危险操作（主按钮红色实心 + 卡片红边） */
  danger: { type: Boolean, default: false },
  jobId: { type: String, default: '' },
  paused: { type: Boolean, default: false },
  pausing: { type: Boolean, default: false },
  /** 是否显示取消按钮 */
  cancellable: { type: Boolean, default: true },
  /** 静止时常驻提示（危险提示 / 运行说明） */
  tip: { type: String, default: '' },
  tipType: { type: String, default: 'info' },
  pausedTip: { type: String, default: '已暂停：不再发起请求，点击「继续」恢复。' },
  /** 进度 { done, total, fail }，透传 RunControl */
  progress: { type: Object, default: null },
  logLines: { type: Array, default: () => [] },
  logHeight: { type: String, default: '280px' },
  /** 只读卡（如扫描预览）可不显示日志面板 */
  logVisible: { type: Boolean, default: true },
});

const emit = defineEmits(['run', 'pause', 'cancel']);
</script>

<template>
  <StepCard :index="index" :title="title" :badge="badge" :class="{ 'danger-card': danger }">
    <slot name="toolbar" />

    <el-table
      v-if="rows.length"
      :data="rows"
      size="small"
      border
      class="preview-table"
      :row-key="rowKeyOf"
      :default-expand-all="false"
    >
      <el-table-column type="expand">
        <template #default="{ row }">
          <slot name="detail" :row="row">
            <div v-if="row.items && row.items.length" class="expand-list">
              <div v-for="it in row.items" :key="it.id || it.name" class="expand-row">
                <span class="e-name" :title="it.name">{{ it.name }}</span>
                <span v-if="it.modelName" class="e-model">{{ it.modelName }}</span>
              </div>
            </div>
            <div v-else class="expand-empty">{{ row.ok ? '无明细' : row.msg }}</div>
          </slot>
        </template>
      </el-table-column>

      <el-table-column prop="name" label="店铺" min-width="150" />
      <el-table-column prop="shopId" label="店铺ID" width="110" />
      <slot name="columns" />

      <el-table-column :label="countLabel" width="110" align="center">
        <template #default="{ row }">
          <span :class="row.ok && countOf(row) ? 'cnt-bad' : 'cnt-ok'">{{ countOf(row) }}</span>
        </template>
      </el-table-column>
      <el-table-column label="状态" width="90" align="center">
        <template #default="{ row }">
          <el-tag v-if="row.status === 'run'" type="warning" size="small">进行中</el-tag>
          <el-tag v-else-if="row.status === 'ok'" type="success" size="small">成功</el-tag>
          <el-tag v-else-if="row.status === 'err'" type="danger" size="small">失败</el-tag>
          <el-tag v-else-if="row.ok" type="success" size="small">成功</el-tag>
          <el-tag v-else type="danger" size="small">失败</el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="msg" label="备注" min-width="140" show-overflow-tooltip />
    </el-table>

    <RunControl
      class="exec-actions"
      :action-text="actionText"
      :running-text="runningText"
      :running="running"
      :can-run="canRun"
      :danger="danger"
      :job-id="jobId"
      :paused="paused"
      :pausing="pausing"
      :cancellable="cancellable"
      :tip="tip"
      :tip-type="tipType"
      :paused-tip="pausedTip"
      :progress="progress"
      @run="emit('run')"
      @pause="emit('pause')"
      @cancel="emit('cancel')"
    />

    <div v-if="logVisible" class="log-box">
      <LogPanel :lines="logLines" :height="logHeight" />
    </div>
  </StepCard>
</template>
