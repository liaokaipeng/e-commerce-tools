// 趋势折线图：ECharts 按需注册 + option 构造（纯函数，无 Vue 依赖）。
// 图形要求：面积填充 + 三级阈值虚线 + 末点按当前告警级别着色 + 可选「上一周期」对比虚线。
// 用 time 轴承载两条序列：把上一周期按末点对齐平移到当前周期，便于看环比。
import * as echarts from 'echarts/core';
import { LineChart } from 'echarts/charts';
import {
  GridComponent,
  TooltipComponent,
  LegendComponent,
  MarkLineComponent,
  MarkPointComponent,
  AxisPointerComponent,
} from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import { LEVEL_COLOR, OK_COLOR } from './constants.js';

// 按需注册：折线图 + 网格 + tooltip + 图例 + 阈值线/末点标注 + 轴指针 + Canvas 渲染
echarts.use([
  LineChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  MarkLineComponent,
  MarkPointComponent,
  AxisPointerComponent,
  CanvasRenderer,
]);

export { echarts };

const PREV_COLOR = '#7d86a0';

/** 指标值命中的告警级别（未配置阈值或值缺失返回 null） */
function levelOfValue(metric, th, v) {
  if (th == null || v == null) return null;
  const dir = (metric && metric.direction) || 'up';
  const hit = (t) => typeof t === 'number' && (dir === 'up' ? v >= t : v <= t);
  if (hit(th.p0)) return 'P0';
  if (hit(th.p1)) return 'P1';
  if (hit(th.p2)) return 'P2';
  return null;
}

/** 把 [min, max] 外扩到 1/2/5×10^k 的整齐边界（splitNumber=3），
 *  避免 ECharts 对带浮点尾差的 min/max 切出 14.879999999999999 之类的刻度标签 */
function niceRange(min, max, parts = 3) {
  const raw = (max - min) / parts;
  if (!isFinite(raw) || raw <= 0) return { min: min - 1, max: max + 1 };
  const mag = 10 ** Math.floor(Math.log10(raw));
  const ratio = raw / mag;
  const step = ratio > 5 ? mag * 10 : ratio > 2 ? mag * 5 : ratio > 1 ? mag * 2 : mag;
  return {
    min: Math.floor(min / step) * step,
    max: Math.ceil(max / step) * step,
  };
}

/** 纵轴标签舍入（与旧版 SVG 图口径一致：≥100 取整、≥1 保留 1 位小数、更小保留 3 位） */
function fmtAxisVal(v) {
  const n = Number(v);
  if (!isFinite(n)) return '';
  const a = Math.abs(n);
  if (a >= 100) return String(Math.round(n));
  if (a >= 1) return String(Math.round(n * 10) / 10);
  return String(Number(n.toFixed(3)));
}

/** 构造折线图 option（trend = { metric, thresholds, points, prev }） */
export function buildTrendOption(trend) {
  const pts = trend.points || [];
  const prev = trend.prev || [];
  const th = trend.thresholds || {};
  const thVals = Object.values(th).filter((x) => typeof x === 'number');
  const vals = pts.map((p) => p.v);
  const prevVals = prev.map((p) => p.v);
  let min = Math.min(...vals, ...prevVals, ...thVals);
  let max = Math.max(...vals, ...prevVals, ...thVals);
  if (!isFinite(min) || !isFinite(max)) { min = 0; max = 1; }
  if (min === max) { min -= 1; max += 1; }
  const span = max - min;
  min -= span * 0.12; max += span * 0.12;
  const nice = niceRange(min, max);
  min = nice.min;
  max = nice.max;

  const p2 = (n) => String(n).padStart(2, '0');
  const fmtTick = (at) => {
    // time 轴的刻度值是毫秒数；category 轴旧数据是字符串时间戳，统一先 Number 再 Date
    const d = new Date(Number(at));
    if (Number.isNaN(d.getTime())) return '';
    return `${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}`;
  };
  const thMeta = [
    { key: 'p0', color: '#FF3B30', label: 'P0 阈值' },
    { key: 'p1', color: '#FF9500', label: 'P1 阈值' },
    { key: 'p2', color: '#FFD60A', label: 'P2 阈值' },
  ];
  const markLines = thMeta
    .filter((t) => typeof th[t.key] === 'number')
    .map((t) => ({
      yAxis: th[t.key],
      lineStyle: { color: t.color, type: 'dashed', width: 1.2 },
      label: { formatter: t.label, color: t.color, position: 'insideEndTop', fontSize: 9 },
    }));
  const last = pts[pts.length - 1];
  const lv = levelOfValue(trend.metric, th, last.v);
  const lastColor = lv ? (LEVEL_COLOR[lv] || '#ffffff') : OK_COLOR;
  const lastLabel = `${last.v}${(trend.metric && trend.metric.unit) || ''}${lv ? '（' + lv + '）' : ''}`;

  // 上一周期按「末点对齐」平移到当前周期（比较「现在 vs 上一周期同一进度」）
  const lastPrev = prev[prev.length - 1];
  const shift = (lastPrev && lastPrev.at) ? (last.at - lastPrev.at) : 0;
  const prevData = prev.map((p) => [p.at + shift, p.v]);

  const series = [
    {
      type: 'line',
      name: (trend.metric && trend.metric.title) || '值',
      data: pts.map((p) => [p.at, p.v]),
      symbol: 'circle',
      symbolSize: 5,
      lineStyle: { color: '#5a6ce0', width: 2 },
      itemStyle: { color: '#5a6ce0' },
      areaStyle: {
        color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
          { offset: 0, color: 'rgba(74, 91, 216, 0.25)' },
          { offset: 1, color: 'rgba(74, 91, 216, 0)' },
        ]),
      },
      markLine: markLines.length ? { symbol: 'none', silent: true, data: markLines } : undefined,
      markPoint: {
        symbol: 'circle',
        symbolSize: 9,
        itemStyle: { color: lastColor },
        label: { color: '#eef1f8', fontSize: 10, fontWeight: 600, position: 'top', distance: 6 },
        data: [{ coord: [last.at, last.v], value: lastLabel }],
      },
    },
  ];
  if (prevData.length) {
    series.push({
      type: 'line',
      name: '上一周期',
      data: prevData,
      symbol: 'none',
      lineStyle: { color: PREV_COLOR, width: 1.4, type: 'dashed' },
      itemStyle: { color: PREV_COLOR },
      z: 1,
    });
  }

  return {
    animationDuration: 200,
    color: ['#5a6ce0', PREV_COLOR],
    grid: { left: 52, right: 16, top: 30, bottom: 26 },
    legend: prevData.length
      ? { top: 4, right: 12, itemWidth: 14, itemHeight: 8, textStyle: { color: '#9aa3ba', fontSize: 10 } }
      : undefined,
    tooltip: {
      trigger: 'axis',
      backgroundColor: '#171b2e',
      borderColor: '#232a4a',
      textStyle: { color: '#eef1f8', fontSize: 12 },
      axisPointer: { type: 'line', lineStyle: { color: '#4a5bd8' } },
      formatter: (params) => {
        const arr = Array.isArray(params) ? params : [params];
        const unit = (trend.metric && trend.metric.unit) || '';
        const head = fmtTick(arr[0] && arr[0].axisValue);
        const lines = arr.map((p) => {
          const raw = Array.isArray(p.value) ? p.value[1] : p.value;
          const v = raw === null || raw === undefined ? '—' : `${raw}${unit}`;
          return `${p.marker}${p.seriesName}：${v}`;
        });
        return [head, ...lines].join('<br/>');
      },
    },
    xAxis: {
      type: 'time',
      boundaryGap: false,
      axisLine: { lineStyle: { color: '#1e2440' } },
      axisTick: { show: false },
      axisLabel: { color: '#6d7690', fontSize: 9, formatter: (v) => fmtTick(v), hideOverlap: true },
      splitLine: { show: false },
    },
    yAxis: {
      type: 'value',
      min,
      max,
      splitNumber: 3,
      axisLabel: { color: '#6d7690', fontSize: 9, formatter: (v) => fmtAxisVal(v) },
      splitLine: { lineStyle: { color: '#1e2440' } },
    },
    series,
  };
}
