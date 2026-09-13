<script setup>
// 中栏：趋势折线图（自持 ECharts 实例与 window resize 监听）+ 多店指标对比矩阵。
import { ref, computed, watch, nextTick, onMounted, onUnmounted } from 'vue';
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

// ---------- 对比矩阵（Element Plus 表格；店铺列 fixed 锁定，横向滚动不隐藏） ----------
// el-table 按列取数，故把每店的 matrix 数组摊平为 __cells: { [metricId]: { v, level } }，
// 单元格的底色 / 文字色 / 失败 ✗ 由 cell-style、cell-class 按列 key 回算。
const matrixRows = computed(() => props.shops.map((s) => {
  const cells = {};
  for (const m of s.matrix || []) cells[m.metric] = m;
  return Object.assign({}, s, { __cells: cells });
}));

const colKey = (column) => (column && (column.columnKey || column.property)) || '';
const isShopCol = (column) => colKey(column) === 'shop';
const cellOf = (row, key) => (row.__cells ? row.__cells[key] : null);

function cellValue(row, key) {
  const c = cellOf(row, key);
  return !c || c.v === null ? '—' : c.v;
}

function cellStyle({ row, column }) {
  if (isShopCol(column)) return {};
  const c = cellOf(row, colKey(column));
  const level = c && c.level;
  return {
    background: level ? LEVEL_COLOR[level] + '33' : 'rgba(255,255,255,0.03)',
    color: level ? LEVEL_COLOR[level] : '#9aa3b5',
  };
}

function cellClass({ row, column }) {
  return isShopCol(column) ? '' : (failInfo(row, colKey(column)) ? 'cell-fail' : '');
}

function rowClass({ row }) {
  return row.shopId === props.selectedShop ? 'row-selected' : '';
}

function metricTip(row, key) {
  const c = cellOf(row, key);
  return cellTitle(row, { metric: key, v: c ? c.v : null });
}

function onCellClick(row, column) {
  emit('select-shop', row.shopId);
  if (!isShopCol(column)) emit('select-metric', colKey(column));
}

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
        <el-table
          :data="matrixRows"
          height="100%"
          size="small"
          class="matrix"
          :row-class-name="rowClass"
          :cell-style="cellStyle"
          :cell-class-name="cellClass"
          @cell-click="onCellClick"
        >
          <el-table-column
            label="店铺"
            column-key="shop"
            fixed="left"
            width="150"
            class-name="rowhead"
            label-class-name="rowhead"
          >
            <template #default="{ row }">
              <span :title="shopName(row)">{{ shopName(row) }}</span>
            </template>
          </el-table-column>
          <el-table-column
            v-for="c in metricChips"
            :key="c.id"
            :column-key="c.id"
            :label="c.title"
            min-width="76"
          >
            <template #header>
              <span :title="c.title + (c.unit ? '（' + c.unit + '）' : '')">{{ c.title }}</span>
            </template>
            <template #default="{ row }">
              <span class="m-val" :title="metricTip(row, c.id)">{{ cellValue(row, c.id) }}</span>
            </template>
          </el-table-column>
        </el-table>
      </div>
    </div>
  </section>
</template>
