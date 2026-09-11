<script setup>
// 中栏：趋势折线图（自持 ECharts 实例与 window resize 监听）+ 多店指标对比矩阵。
import { ref, watch, nextTick, onMounted, onUnmounted } from 'vue';
import { echarts, buildTrendOption } from './trend-chart.js';
import { LEVEL_COLOR, DOMAIN_LABEL, shopName, failInfo, cellTitle } from './constants.js';

const props = defineProps({
  shops: { type: Array, default: () => [] },
  selectedShop: { type: String, default: '' },
  selectedShopObj: { type: Object, default: null },
  selectedMetric: { type: String, default: '' },
  metricChips: { type: Array, default: () => [] },
  selectedFail: { type: Object, default: null },
  trend: { type: Object, required: true },
});

const emit = defineEmits(['select-shop', 'select-metric']);

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
  () => props.trend.points,
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
  <section class="center">
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
      </div>
      <div v-if="!selectedShopObj" class="chart-empty">选择一家店铺查看 7 天趋势曲线</div>
      <div v-else-if="trend.points.length" ref="chartEl" class="chart"></div>
      <div v-else class="chart-empty">暂无「{{ trend.metric.title }}」采样数据，等待采集（订单 10 分钟 / 商品 30 分钟 / 健康·广告·资金·售后 60 分钟）</div>
    </div>

    <div class="panel matrix-panel">
      <h3>多店指标对比矩阵 <small>底色 = 该店该指标当前告警级别 · 红框 ✗ = 该域最近采集失败 · 点击单元格看趋势</small></h3>
      <div class="matrix-wrap">
        <table class="matrix">
          <thead>
            <tr>
              <th class="rowhead">店铺</th>
              <th v-for="c in metricChips" :key="c.id" :title="c.title + (c.unit ? '（' + c.unit + '）' : '')">{{ c.title }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="s in shops" :key="s.shopId" :class="{ selected: s.shopId === selectedShop }">
              <td class="rowhead" @click="emit('select-shop', s.shopId)">{{ shopName(s) }}</td>
              <td
                v-for="m in s.matrix"
                :key="m.metric"
                class="cell"
                :class="{ 'cell-fail': failInfo(s, m.metric) }"
                :style="{ background: m.level ? LEVEL_COLOR[m.level] + '33' : 'rgba(255,255,255,0.03)', color: m.level ? LEVEL_COLOR[m.level] : '#9aa3b5' }"
                :title="cellTitle(s, m)"
                @click="emit('select-shop', s.shopId); emit('select-metric', m.metric)"
              >{{ m.v === null ? '—' : m.v }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </section>
</template>
