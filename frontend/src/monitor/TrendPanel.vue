<script setup>
// 趋势折线图：自持 ECharts 实例与 window resize 监听，支持 1/7/30 天时间窗与环比对比线。
import { ref, watch, nextTick, onMounted, onUnmounted } from 'vue';
import { echarts, buildTrendOption } from './trend-chart.js';
import { DOMAIN_LABEL, shopName } from './constants.js';

const props = defineProps({
  selectedShopObj: { type: Object, default: null },
  selectedMetric: { type: String, default: '' },
  metricChips: { type: Array, default: () => [] },
  selectedFail: { type: Object, default: null },
  trend: { type: Object, required: true },
  trendDays: { type: Number, default: 7 },
  trendCompare: { type: Boolean, default: true },
});

const emit = defineEmits(['select-metric', 'select-days', 'toggle-compare']);

const RANGE_OPTIONS = [1, 7, 30];

const chartEl = ref(null);
let chart = null;

/** 初始化/更新 ECharts 实例（容器随 v-if 变化，DOM 更换时重建实例） */
function renderChart() {
  if (!chartEl.value) return;
  if (chart && chart.getDom() !== chartEl.value) {
    chart.dispose();
    chart = null;
  }
  if (!chart) chart = echarts.init(chartEl.value);
  if (props.trend.points && props.trend.points.length) chart.setOption(buildTrendOption(props.trend), true);
}

function onWinResize() {
  if (chart) chart.resize();
}

watch(
  () => [props.trend.points, props.trend.prev],
  async () => {
    await nextTick();
    renderChart();
  }
);

onMounted(async () => {
  window.addEventListener('resize', onWinResize);
  // 挂载时若已有采样点（如切换 Tab 后重新进入），先补一次渲染
  await nextTick();
  renderChart();
});

onUnmounted(() => {
  if (chart) { chart.dispose(); chart = null; }
  window.removeEventListener('resize', onWinResize);
});
</script>

<template>
  <div class="panel trend-panel">
    <div class="tp-head">
      <b class="tp-shop" :title="selectedShopObj ? '当前查看：' + shopName(selectedShopObj) + '（点左侧店铺卡或矩阵行切换）' : '点左侧店铺卡选择店铺'">
        {{ selectedShopObj ? shopName(selectedShopObj) : '未选择店铺' }}
      </b>
      <i
        v-if="selectedFail"
        class="tp-fail"
        :title="'该指标所属' + DOMAIN_LABEL[selectedFail.dom] + '域最近采集失败 ' + selectedFail.count + ' 次' + (selectedFail.message ? '：' + selectedFail.message : '')"
      >⚠ {{ DOMAIN_LABEL[selectedFail.dom] }}域采集失败 {{ selectedFail.count }} 次</i>
      <div class="chips">
        <button
          v-for="c in metricChips"
          :key="c.id"
          :class="{ active: selectedMetric === c.id }"
          @click="emit('select-metric', c.id)"
        >{{ c.title }}</button>
      </div>
      <div class="tp-range">
        <button
          v-for="d in RANGE_OPTIONS"
          :key="d"
          :class="{ active: trendDays === d }"
          @click="emit('select-days', d)"
        >{{ d }}天</button>
        <label class="tp-cmp" title="叠加显示上一个同长度周期，便于看环比">
          <el-switch :model-value="trendCompare" size="small" @change="(v) => emit('toggle-compare', v)" />环比
        </label>
      </div>
    </div>
    <div v-if="!selectedShopObj" class="chart-empty">选择一家店铺查看趋势曲线</div>
    <div v-else-if="trend.points.length" ref="chartEl" class="chart"></div>
    <div v-else class="chart-empty">暂无「{{ trend.metric.title }}」采样数据，等待采集（订单 10 分钟 / 商品 30 分钟 / 健康·广告·资金·售后 60 分钟）</div>
  </div>
</template>
