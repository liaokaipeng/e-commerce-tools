<script setup>
// 右栏：实时告警流。P0 脉冲置顶、按级别筛选、可确认/关闭。
import { LEVEL_COLOR, LEVEL_NAME, shopName, fmtTime } from './constants.js';

const filterLevel = defineModel('filterLevel', { type: String, default: '' });

const props = defineProps({
  alerts: { type: Array, default: () => [] },
  openCount: { type: Number, default: 0 },
  shops: { type: Array, default: () => [] },
  flashIds: { type: Object, required: true },
});

const emit = defineEmits(['action']);

/** 告警所属店铺名（列表里找不到时给空串，与原实现一致） */
function shopNameOf(shopId) {
  return shopName(props.shops.find((s) => s.shopId === shopId));
}
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
        <el-radio-button value="recovered">已恢复</el-radio-button>
      </el-radio-group>
    </div>
    <div class="alert-list">
      <div v-if="!alerts.length" class="alert-empty">暂无告警，一切正常 🎉</div>
      <div
        v-for="a in alerts"
        :key="a.id + ':' + a.seq"
        class="alert-item"
        :class="['alv-' + a.level, { recovered: a.status === 'recovered' }, { flashing: flashIds.has(a.id), ack: a.status === 'ack' }]"
        :title="a.suggest || ''"
      >
        <div class="ai-bar" :style="{ background: a.status === 'recovered' ? '#5b6272' : LEVEL_COLOR[a.level] }"></div>
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
            <i v-if="a.status === 'recovered'" class="ai-recovered">✓ 已恢复</i>
            <i v-else-if="a.status === 'ack'" class="ai-ack">已确认</i>
          </div>
          <div v-if="a.status === 'open' || a.status === 'ack'" class="ai-ops">
            <el-button v-if="a.status === 'open'" size="small" @click="emit('action', a, 'ack')">确认</el-button>
            <el-button size="small" type="danger" plain @click="emit('action', a, 'close')">关闭</el-button>
          </div>
        </div>
      </div>
    </div>
  </aside>
</template>
