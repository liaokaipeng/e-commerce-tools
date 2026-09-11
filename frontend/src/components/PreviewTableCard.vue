<!-- 预览表格卡片：展开行明细 + 店铺/数量/状态列 + 底部执行区（含暂停/继续/取消）。
     bidding-cancel 与 hotlisting-cancel 两页同源复用；两页的差异（是否有 SPU 列、明细列内容）
     通过 extra-columns / #detail 插槽注入，样式在 styles/base.css 的 .preview-card 区块统一定义。 -->
<script setup>
import LogPanel from './LogPanel.vue';

defineProps({
  title: { type: String, required: true },
  /** 卡片头部右侧提示（如「待改进竞价共 12 条」） */
  badge: { type: String, default: '' },
  rows: { type: Array, default: () => [] },
  /** 行唯一键：(row) => string */
  rowKeyOf: { type: Function, required: true },
  /** 数量列标题与取值 */
  countLabel: { type: String, default: '数量' },
  countOf: { type: Function, required: true },
  /** 执行区 */
  actionTitle: { type: String, default: '' },
  actionText: { type: String, default: '开始执行' },
  runningText: { type: String, default: '执行中…' },
  dangerTip: { type: String, default: '' },
  running: { type: Boolean, default: false },
  canRun: { type: Boolean, default: false },
  jobId: { type: String, default: '' },
  paused: { type: Boolean, default: false },
  pausing: { type: Boolean, default: false },
  /** 暂停时替换 dangerTip 显示的提示 */
  pausedTip: { type: String, default: '已暂停：不再发起请求，点击「继续」恢复。' },
  logLines: { type: Array, default: () => [] },
  /** 是否显示取消按钮（hotlisting / bidding 均已支持） */
  cancellable: { type: Boolean, default: true },
  danger: { type: Boolean, default: true },
});

const emit = defineEmits(['run', 'pause', 'cancel']);
</script>

<template>
  <el-card shadow="never" class="card" :class="{ 'danger-card': danger }">
    <template #header>
      <div class="card-header-row">
        <span>{{ title }}</span>
        <span v-if="badge" class="sel-count warn">{{ badge }}</span>
      </div>
    </template>

    <template v-if="$slots.toolbar">
      <slot name="toolbar" />
    </template>

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

    <div class="actions exec-actions">
      <el-button type="danger" size="large" :disabled="!canRun" :loading="running && !paused" @click="emit('run')">
        {{ running ? runningText : actionText }}
      </el-button>
      <el-button
        v-if="running && jobId"
        size="large"
        :type="paused ? 'success' : 'warning'"
        :loading="pausing"
        @click="emit('pause')"
      >
        {{ paused ? '继续' : '暂停' }}
      </el-button>
      <el-button v-if="running && jobId && cancellable" size="large" plain @click="emit('cancel')">
        取消任务
      </el-button>
      <span v-if="running && paused" class="paused-tip">{{ pausedTip }}</span>
      <span v-else-if="dangerTip" class="danger-tip">{{ dangerTip }}</span>
    </div>

    <div class="log-box">
      <LogPanel :lines="logLines" height="320px" />
    </div>
  </el-card>
</template>
