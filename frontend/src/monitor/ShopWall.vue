<script setup>
// 左栏：店铺健康墙。按告警级别置顶排序（排序由父组件完成），点击卡片切换当前店铺。
import { LEVEL_COLOR, OK_COLOR, DOMAIN_LABEL, shopName, fmtTime } from './constants.js';

defineProps({
  shops: { type: Array, default: () => [] },
  selectedShop: { type: String, default: '' },
});

const emit = defineEmits(['select']);
</script>

<template>
  <aside class="panel shops">
    <h3>店铺健康墙 <small>按告警级别自动置顶</small></h3>
    <div class="shop-list">
      <div
        v-for="s in shops"
        :key="s.shopId"
        class="shop-card"
        :class="['lv-' + (s.authBroken ? 'reauth' : s.alerts.maxLevel || 'ok'), { selected: s.shopId === selectedShop }, { flashing: s.alerts.maxLevel === 'P0' && !s.authBroken }]"
        @click="emit('select', s.shopId)"
      >
        <div class="sc-head">
          <span class="dot" :style="{ background: s.authBroken ? '#8f95a8' : LEVEL_COLOR[s.alerts.maxLevel] || OK_COLOR }"></span>
          <b class="sc-name">{{ shopName(s) }}</b>
          <span class="sc-badges">
            <i v-if="s.authBroken" class="b-reauth" :title="'授权已失效，重新授权后自动恢复采集'">待重新授权</i>
            <template v-else>
              <i v-if="s.alerts.P0" class="b-P0">P0×{{ s.alerts.P0 }}</i>
              <i v-if="s.alerts.P1" class="b-P1">P1×{{ s.alerts.P1 }}</i>
              <i v-if="s.alerts.P2" class="b-P2">P2×{{ s.alerts.P2 }}</i>
              <i v-if="!s.alerts.maxLevel" class="b-ok">正常</i>
            </template>
          </span>
        </div>
        <div class="sc-foot" :title="s.lastError && Object.keys(s.lastError).length ? JSON.stringify(s.lastError) : ''">
          <span
            v-for="(label, dom) in DOMAIN_LABEL"
            :key="dom"
            :class="{ bad: s.failCount[dom], off: s.unsupported && s.unsupported[dom] }"
            :title="s.unsupported && s.unsupported[dom] ? '该域无权限/未开通，已跳过采集：' + s.unsupported[dom].reason : ''"
          >
            {{ label }}{{ s.unsupported && s.unsupported[dom] ? '—' : s.lastRun[dom] ? '✓' + fmtTime(s.lastRun[dom]) : s.failCount[dom] ? '✗' + s.failCount[dom] + '次' : '·' }}
          </span>
        </div>
      </div>
    </div>
  </aside>
</template>
