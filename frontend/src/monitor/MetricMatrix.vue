<script setup>
// 多店指标对比矩阵：按采集域分组表头，命中告警的单元格加重底色 + 加粗。
import { computed } from 'vue';
import { DOMAIN_LABEL, shopName, failInfo, cellTitle, domainOf } from './constants.js';

const props = defineProps({
  shops: { type: Array, default: () => [] },
  selectedShop: { type: String, default: '' },
  metricChips: { type: Array, default: () => [] },
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

/** 指标按采集域分组（保持 MATRIX_METRICS 顺序），用于两级表头 */
const metricGroups = computed(() => {
  const groups = [];
  for (const c of props.metricChips) {
    const dom = domainOf(c.id) || 'other';
    let g = groups.find((x) => x.dom === dom);
    if (!g) { g = { dom, label: DOMAIN_LABEL[dom] || dom, chips: [] }; groups.push(g); }
    g.chips.push(c);
  }
  return groups;
});

const colKey = (column) => (column && (column.columnKey || column.property)) || '';
const isShopCol = (column) => colKey(column) === 'shop';
const cellOf = (row, key) => (row.__cells ? row.__cells[key] : null);

// 命中级别的单元格底色（比原实现更实，配白字保证对比度；加粗作为「非纯颜色」的第二重提示）
const CELL_TINT = { P0: 'rgba(255,59,48,.30)', P1: 'rgba(255,149,0,.30)', P2: 'rgba(255,214,10,.26)' };

function cellValue(row, key) {
  const c = cellOf(row, key);
  return !c || c.v === null ? '—' : c.v;
}

function cellStyle({ row, column }) {
  if (isShopCol(column)) return {};
  const c = cellOf(row, colKey(column));
  const level = c && c.level;
  return {
    background: level ? CELL_TINT[level] : 'rgba(255,255,255,0.03)',
    color: level ? '#ffffff' : 'var(--d-text-3)',
  };
}

function cellClass({ row, column }) {
  if (isShopCol(column)) return '';
  const key = colKey(column);
  const c = cellOf(row, key);
  const cls = [];
  if (c && c.level) cls.push('cell-hot');
  if (failInfo(row, key)) cls.push('cell-fail');
  return cls.join(' ');
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
</script>

<template>
  <div class="panel matrix-panel">
    <h3>多店指标对比矩阵 <small>底色加深 + 加粗 = 该指标已触发告警 · 红框 ✗ = 该域最近采集失败 · 点击单元格看趋势</small></h3>
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
          v-for="g in metricGroups"
          :key="g.dom"
          :label="g.label"
          align="center"
          label-class-name="dom-head"
        >
          <el-table-column
            v-for="c in g.chips"
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
        </el-table-column>
      </el-table>
    </div>
  </div>
</template>
