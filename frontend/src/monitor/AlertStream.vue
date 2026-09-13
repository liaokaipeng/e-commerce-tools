<script setup>
// 右栏：实时告警流。P0 脉冲置顶、按级别筛选；人工操作只有「删除」（单条 / 批量）。
// 删除即移除该条告警，若下轮采集仍异常会重新出现并重新计数。
// 每条显示「已持续」时长，帮助快速判断问题卡了多久。
import { reactive, computed, watch } from 'vue';
import { LEVEL_COLOR, LEVEL_NAME, shopName, fmtTime, fmtDuration } from './constants.js';

const filterLevel = defineModel('filterLevel', { type: String, default: '' });

const props = defineProps({
  alerts: { type: Array, default: () => [] },
  openCount: { type: Number, default: 0 },
  shops: { type: Array, default: () => [] },
  flashIds: { type: Object, required: true },
  now: { type: Number, default: 0 },
});

const emit = defineEmits(['action', 'detail', 'batch-action']);

/** 告警所属店铺名（列表里找不到时给空串，与原实现一致） */
function shopNameOf(shopId) {
  return shopName(props.shops.find((s) => s.shopId === shopId));
}

// ---------- 多选批量删除 ----------
const selected = reactive(new Set());
const allSelected = computed(() => props.alerts.length > 0 && props.alerts.every((a) => selected.has(a.id)));

function toggle(id) {
  if (selected.has(id)) selected.delete(id);
  else selected.add(id);
}

function toggleAll() {
  if (allSelected.value) selected.clear();
  else for (const a of props.alerts) selected.add(a.id);
}

function emitBatch() {
  const ids = [...selected];
  if (!ids.length) return;
  selected.clear();
  emit('batch-action', ids, 'delete');
}

// 列表变化后清理已不存在的选中项（避免「幽灵选中」）
watch(() => props.alerts, (list) => {
  const ids = new Set(list.map((a) => a.id));
  for (const id of [...selected]) if (!ids.has(id)) selected.delete(id);
});

const durationOf = (a) => fmtDuration((props.now || Date.now()) - a.firstAt);
</script>

<template>
  <aside class="panel alerts">
    <h3>实时告警流</h3>
    <div class="filter">
      <el-radio-group v-model="filterLevel" size="small">
        <el-radio-button :value="''">全部({{ openCount }})</el-radio-button>
        <el-radio-button value="P0">P0</el-radio-button>
        <el-radio-button value="P1">P1</el-radio-button>
        <el-radio-button value="P2">P2</el-radio-button>
      </el-radio-group>
    </div>
    <div v-if="alerts.length" class="batch-bar">
      <el-checkbox
        :model-value="allSelected"
        :indeterminate="selected.size > 0 && !allSelected"
        size="small"
        @change="toggleAll"
      >全选</el-checkbox>
      <span class="dim2">已选 {{ selected.size }}</span>
      <div class="batch-ops">
        <el-button size="small" type="danger" plain :disabled="!selected.size" @click="emitBatch">批量删除</el-button>
      </div>
    </div>
    <div class="alert-list">
      <div v-if="!alerts.length" class="alert-empty">暂无告警，一切正常 🎉</div>
      <div
        v-for="a in alerts"
        :key="a.id + ':' + a.seq"
        class="alert-item"
        :class="['alv-' + a.level, { flashing: flashIds.has(a.id), ack: a.status === 'ack' }]"
        :title="a.suggest || ''"
      >
        <el-checkbox
          class="ai-check"
          :model-value="selected.has(a.id)"
          @click.stop
          @change="toggle(a.id)"
        />
        <div class="ai-bar" :style="{ background: LEVEL_COLOR[a.level] }"></div>
        <div class="ai-body">
          <div class="ai-head">
            <i class="ai-level" :style="{ background: LEVEL_COLOR[a.level] }">{{ a.level }} {{ LEVEL_NAME[a.level] }}</i>
            <b>{{ a.title }}</b>
            <span class="ai-shop">{{ shopNameOf(a.shopId) }}</span>
            <span class="ai-time">{{ fmtTime(a.lastAt) }}</span>
          </div>
          <div class="ai-msg">
            {{ a.message }}
            <i v-if="a.count > 1" class="ai-count">×{{ a.count }}</i>
            <i v-if="a.status === 'ack'" class="ai-ack">已确认</i>
            <i v-if="a.status === 'open' || a.status === 'ack'" class="ai-dur">已持续 {{ durationOf(a) }}</i>
          </div>
          <div class="ai-ops">
            <el-button size="small" @click="emit('detail', a)">详情</el-button>
            <el-button size="small" type="danger" plain @click="emit('action', a, 'delete')">删除</el-button>
          </div>
        </div>
      </div>
    </div>
  </aside>
</template>
