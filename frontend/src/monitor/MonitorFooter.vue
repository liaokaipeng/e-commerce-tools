<script setup>
// 底栏：P0/P1 未处理告警跑马灯 + 采集状态条。
defineProps({
  overview: { type: Object, required: true },
  tickerText: { type: String, default: '' },
  openTopAlerts: { type: Array, default: () => [] },
});
</script>

<template>
  <footer v-if="overview.shops.length" class="foot">
    <div class="ticker-wrap">
      <div class="ticker" :class="{ anim: openTopAlerts.length > 1 }">
        <template v-if="tickerText">
          <span v-for="n in 2" :key="n" class="ticker-seg">{{ tickerText }}　·　</span>
        </template>
        <template v-else>当前无未处理的 P0/P1 告警</template>
      </div>
    </div>
    <div class="coll-strip">
      <span class="cs-item" :class="{ bad: !overview.scheduler.running }">
        {{ overview.scheduler.running ? (overview.scheduler.presenceActive ? '巡检运行中' : '巡检待机（离开本页即暂停采集）') : '巡检已停止' }}
        <i v-if="overview.scheduler.active">·{{ overview.scheduler.active }} 项采集中</i>
      </span>
    </div>
  </footer>
</template>
