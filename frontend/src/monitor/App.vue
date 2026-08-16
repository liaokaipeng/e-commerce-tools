<script setup>
// 虾皮多店监控大屏（一期）
// 数据流：GET /api/monitor/overview（总览+矩阵定级）/alerts（告警流）/trend（趋势）/rules（规则）
//         + /api/monitor/events SSE 实时推送（告警变更/采集结果，迟到回放），30s 兜底轮询。
// 告警只在本页展示（本期不接 IM）：P0 红色脉冲置顶 + 声音提醒，P1 橙色，P2 黄色。
import { ref, reactive, computed, watch, nextTick, onMounted, onUnmounted } from 'vue';
import { ElMessage } from 'element-plus';
import * as echarts from 'echarts/core';
import { LineChart } from 'echarts/charts';
import {
  GridComponent,
  TooltipComponent,
  MarkLineComponent,
  MarkPointComponent,
  AxisPointerComponent,
} from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';

// 按需注册：折线图 + 网格 + tooltip + 阈值线/末点标注 + 轴指针 + Canvas 渲染
echarts.use([
  LineChart,
  GridComponent,
  TooltipComponent,
  MarkLineComponent,
  MarkPointComponent,
  AxisPointerComponent,
  CanvasRenderer,
]);

const LEVEL_COLOR = { P0: '#FF3B30', P1: '#FF9500', P2: '#FFD60A' };
const LEVEL_NAME = { P0: '紧急', P1: '重要', P2: '提醒' };
const OK_COLOR = '#30D158';
const MATRIX_METRICS = [
  'order.pending_24h', 'firstmile.unbound', 'product.out_of_stock', 'product.low_stock',
  'product.violations', 'health.late_shipment_rate', 'health.non_fulfilment_rate', 'health.rating',
  'health.punishments', 'ads.spend_today', 'ads.roas_today', 'ads.cpc_today', 'ads.balance',
  'funds.payout_15d', 'funds.pending_txn', 'funds.failed_txn', 'funds.wallet_balance',
  'aftersale.returns_24h', 'aftersale.negative_24h',
];
const DOMAIN_LABEL = { order: '订单', product: '商品', health: '健康', ads: '广告', funds: '资金', aftersale: '售后' };
// 指标 id 前缀 → 采集域（与调度任务域一致，用于定位「哪个域采集失败」）
const METRIC_DOMAIN = [
  ['order', ['order.', 'firstmile.']],
  ['product', ['product.']],
  ['health', ['health.']],
  ['ads', ['ads.']],
  ['funds', ['funds.']],
  ['aftersale', ['aftersale.']],
];
function domainOf(metric) {
  for (const [dom, prefixes] of METRIC_DOMAIN) {
    if (prefixes.some((p) => metric.startsWith(p))) return dom;
  }
  return '';
}

/** 该店该指标所属域的最近采集失败信息（无失败返回 null） */
function failInfo(s, metric) {
  const dom = domainOf(metric);
  const count = dom && s.failCount ? s.failCount[dom] || 0 : 0;
  if (!count) return null;
  const err = s.lastError && s.lastError[dom];
  return { dom, count, message: err && err.message ? err.message : '' };
}

/** 矩阵单元格悬浮提示（仅采集失败时非空） */
function cellTitle(s, m) {
  const fi = failInfo(s, m.metric);
  if (!fi) return '';
  const val = m.v === null ? '无数据' : `值 ${m.v}（上次成功采集的旧值）`;
  return `${val} · ${DOMAIN_LABEL[fi.dom]}域最近采集失败 ${fi.count} 次${fi.message ? '：' + fi.message : ''}`;
}

// ---------- 状态 ----------
const overview = reactive({
  configured: false,
  scheduler: { running: false, active: 0, lastTickAt: 0 },
  totals: { P0: 0, P1: 0, P2: 0, recovered: 0 },
  reAuthCount: 0,
  excludedCount: 0,
  currencyMode: 'local', // 金额展示单位：local=当地货币（默认）/ rmb=人民币；规则阈值始终按人民币
  metrics: {},
  shops: [],
  at: 0,
});
const alerts = ref([]);
const rules = ref([]);
const trend = reactive({ metric: { id: '', title: '', unit: '' }, thresholds: null, points: [] });
const selectedShop = ref('');
const selectedMetric = ref('order.pending_24h');
const filterLevel = ref('');
const projectMode = ref(false);
const soundOn = ref(true);
const rotateOn = ref(true);
const sseOk = ref(false);
const flashIds = reactive(new Set());
const rulesDrawer = ref(false);
const ruleEdits = ref([]);
const savingRules = ref(false);
const shopsDrawer = ref(false);
const shopConfig = ref([]);
const savingShops = ref(false);
const shopSearch = ref('');
const now = ref(Date.now());

let es = null;
let refreshTimer = null;
let rotateTimer = null;
let audioCtx = null;

// ---------- 计算 ----------
const levelRank = (lv) => (lv === 'P0' ? 3 : lv === 'P1' ? 2 : lv === 'P2' ? 1 : 0);

function shopName(s) {
  if (!s) return '';
  return s.name || '店铺…' + String(s.shopId).slice(-4);
}

const sortedShops = computed(() => {
  const arr = overview.shops.slice();
  arr.sort((a, b) => levelRank(b.alerts.maxLevel) - levelRank(a.alerts.maxLevel) || shopName(a).localeCompare(shopName(b)));
  return arr;
});

const normalCount = computed(() => overview.shops.filter((s) => !s.alerts.maxLevel).length);

const reAuthCount = computed(() => overview.reAuthCount || overview.shops.filter((s) => s.authBroken).length);

/** 跳转到门户页「开放平台」Tab（同源 iframe，经 parent postMessage 切 Tab） */
function goOpenapi() {
  try { window.parent.postMessage({ type: 'switch-tab', key: 'openapi' }, location.origin || '*'); } catch { /* 忽略 */ }
  showToast('请到「开放平台」Tab 用主账号重新授权一次，全部店铺即恢复');
}

const shownAlerts = computed(() => {
  let list = alerts.value;
  if (filterLevel.value === 'recovered') list = list.filter((a) => a.status === 'recovered');
  else {
    list = list.filter((a) => a.status !== 'recovered');
    if (filterLevel.value) list = list.filter((a) => a.level === filterLevel.value);
  }
  return list;
});

const openTopAlerts = computed(() => alerts.value.filter((a) => a.status === 'open' && (a.level === 'P0' || a.level === 'P1')));

const openCount = computed(() => alerts.value.filter((a) => a.status !== 'recovered').length);

const tickerText = computed(() => openTopAlerts.value
  .map((a) => `【${a.level}】${shopName(overview.shops.find((s) => s.shopId === a.shopId))} ${a.title}：${a.message}`)
  .join('　·　'));

const metricChips = computed(() => MATRIX_METRICS.map((id) => Object.assign({ id }, overview.metrics[id] || { title: id, unit: '' })));

const selectedShopObj = computed(() => overview.shops.find((s) => s.shopId === selectedShop.value) || null);
/** 当前所选店铺+指标的采集失败信息（趋势面板警示用） */
const selectedFail = computed(() => (selectedShopObj.value && selectedMetric.value
  ? failInfo(selectedShopObj.value, selectedMetric.value) : null));

// ---------- 趋势图（ECharts 折线图：面积填充 + 阈值虚线 + 末点按级别着色） ----------
function levelOfValue(metric, th, v) {
  if (th == null || v == null) return null;
  const dir = (metric && metric.direction) || 'up';
  const hit = (t) => typeof t === 'number' && (dir === 'up' ? v >= t : v <= t);
  if (hit(th.p0)) return 'P0';
  if (hit(th.p1)) return 'P1';
  if (hit(th.p2)) return 'P2';
  return null;
}

const chartEl = ref(null);
let chart = null;

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

function buildTrendOption() {
  const pts = trend.points || [];
  const th = trend.thresholds || {};
  const thVals = Object.values(th).filter((x) => typeof x === 'number');
  const vals = pts.map((p) => p.v);
  let min = Math.min(...vals, ...thVals);
  let max = Math.max(...vals, ...thVals);
  if (min === max) { min -= 1; max += 1; }
  const span = max - min;
  min -= span * 0.12; max += span * 0.12;
  const nice = niceRange(min, max);
  min = nice.min;
  max = nice.max;

  const p2 = (n) => String(n).padStart(2, '0');
  const fmtTick = (at) => {
    // 类目轴的类别值是字符串（数字时间戳被转成 "1786864001032"），
    // 必须先 Number() 再 new Date，否则得到 Invalid Date（横轴全是 NaN）
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
  const mid = Math.floor((pts.length - 1) / 2);

  return {
    animationDuration: 200,
    grid: { left: 52, right: 16, top: 18, bottom: 26 },
    tooltip: {
      trigger: 'axis',
      backgroundColor: '#171b2e',
      borderColor: '#232a4a',
      textStyle: { color: '#e6e9f2', fontSize: 12 },
      axisPointer: { type: 'line', lineStyle: { color: '#4a5bd8' } },
      formatter: (params) => {
        const arr = Array.isArray(params) ? params : [params];
        const unit = (trend.metric && trend.metric.unit) || '';
        const head = fmtTick(arr[0] && arr[0].axisValue);
        const lines = arr.map((p) => {
          const v = p.value === null || p.value === undefined ? '—' : `${p.value}${unit}`;
          return `${p.marker}${p.seriesName}：${v}`;
        });
        return [head, ...lines].join('<br/>');
      },
    },
    xAxis: {
      type: 'category',
      boundaryGap: false,
      data: pts.map((p) => p.at),
      axisLine: { lineStyle: { color: '#1e2440' } },
      axisTick: { show: false },
      axisLabel: {
        color: '#6d7690',
        fontSize: 9,
        formatter: (v) => fmtTick(v),
        // 与旧版一致：仅显示首 / 中 / 尾三个时间标签
        interval: (idx) => idx === 0 || idx === pts.length - 1 || idx === mid,
      },
    },
    yAxis: {
      type: 'value',
      min,
      max,
      splitNumber: 3,
      axisLabel: { color: '#6d7690', fontSize: 9, formatter: (v) => fmtAxisVal(v) },
      splitLine: { lineStyle: { color: '#1e2440' } },
    },
    series: [
      {
        type: 'line',
        name: (trend.metric && trend.metric.title) || '值',
        data: vals,
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
          label: { color: '#dfe3f2', fontSize: 10, fontWeight: 600, position: 'top', distance: 6 },
          data: [{ coord: [pts.length - 1, last.v], value: lastLabel }],
        },
      },
    ],
  };
}

/** 初始化/更新 ECharts 实例（容器随 v-if 变化，DOM 更换时重建实例） */
function renderChart() {
  if (!chartEl.value) return;
  if (chart && chart.getDom() !== chartEl.value) {
    chart.dispose();
    chart = null;
  }
  if (!chart) chart = echarts.init(chartEl.value);
  if (trend.points && trend.points.length) chart.setOption(buildTrendOption(), true);
}

function onWinResize() {
  if (chart) chart.resize();
}

watch(
  () => trend.points,
  async () => {
    await nextTick();
    renderChart();
  }
);

// ---------- 工具函数 ----------
function fmtClock(ms) {
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function fmtTime(ms) {
  if (!ms) return '—';
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  const today = new Date().toDateString() === d.toDateString();
  return (today ? '' : `${p(d.getMonth() + 1)}-${p(d.getDate())} `) + `${p(d.getHours())}:${p(d.getMinutes())}`;
}

function fmtVal(v, unit) {
  if (v === null || v === undefined) return '—';
  return v + (unit || '');
}

function flash(id) {
  flashIds.add(id);
  setTimeout(() => flashIds.delete(id), 4000);
}

function showToast(msg, type = 'info') {
  if (type === 'success') ElMessage.success(msg);
  else if (type === 'error') ElMessage.error(msg);
  else if (type === 'warning') ElMessage.warning(msg);
  else ElMessage.info(msg);
}

function beep(times = 1) {
  if (!soundOn.value) return;
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    for (let i = 0; i < times; i++) {
      const t0 = audioCtx.currentTime + i * 0.55;
      const o = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      o.type = 'square';
      o.frequency.value = 880;
      g.gain.setValueAtTime(0.06, t0);
      g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.35);
      o.connect(g);
      g.connect(audioCtx.destination);
      o.start(t0);
      o.stop(t0 + 0.4);
    }
  } catch { /* 音频不可用则静默 */ }
}

// ---------- 接口调用 ----------
async function loadOverview() {
  try {
    const r = await fetch('/api/monitor/overview');
    const j = await r.json();
    if (j && j.ok) {
      Object.assign(overview, j);
      // 所选店铺可能已被停用监控：不在列表中则改选第一家
      if (selectedShop.value && !overview.shops.some((s) => s.shopId === selectedShop.value)) {
        const first = overview.shops.find((s) => s.alerts.maxLevel) || overview.shops[0];
        selectShop(first ? first.shopId : '');
      }
    }
  } catch { /* 服务未就绪，兜底轮询重试 */ }
}

async function loadAlerts() {
  try {
    const r = await fetch('/api/monitor/alerts');
    const j = await r.json();
    if (j && j.ok) alerts.value = j.alerts || [];
  } catch { /* 同上 */ }
}

async function loadRules() {
  try {
    const r = await fetch('/api/monitor/rules');
    const j = await r.json();
    if (j && j.ok) rules.value = j.rules || [];
  } catch { /* 忽略 */ }
}

async function loadTrend(shopId, metric) {
  trend.points = [];
  if (!shopId || !metric) return;
  try {
    const r = await fetch(`/api/monitor/trend?shopId=${encodeURIComponent(shopId)}&metric=${encodeURIComponent(metric)}&days=7`);
    const j = await r.json();
    if (j && j.ok) {
      trend.metric = j.metric || trend.metric;
      trend.thresholds = j.thresholds;
      trend.points = j.points || [];
    }
  } catch { /* 忽略 */ }
}

function refreshSoon() {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => { loadOverview(); loadAlerts(); }, 800);
}

function upsertAlert(a) {
  if (!a) return;
  const i = alerts.value.findIndex((x) => x.id === a.id);
  if (a.status === 'closed') {
    if (i >= 0) alerts.value.splice(i, 1);
  } else if (i >= 0) alerts.value.splice(i, 1, a);
  else alerts.value.unshift(a);
  alerts.value.sort((x, y) => levelRank(y.level) - levelRank(x.level) || y.updatedAt - x.updatedAt);
}

async function alertAction(a, action) {
  try {
    const r = await fetch('/api/monitor/alert-action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: a.id, action }),
    });
    const j = await r.json();
    if (r.ok && j.ok) {
      upsertAlert(j.alert);
      showToast(action === 'ack' ? '已确认' : '已关闭', 'success');
    } else showToast(j.message || '操作失败', 'error');
  } catch (e) {
    showToast('本地服务异常：' + e.message, 'error');
  }
}

async function manualCollect() {
  try {
    const r = await fetch('/api/monitor/collect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ shopId: selectedShop.value || '' }),
    });
    const j = await r.json();
    showToast(r.ok && j.ok ? j.message || '已触发采集' : j.message || '触发失败', r.ok && j.ok ? 'success' : 'error');
  } catch (e) {
    showToast('本地服务异常：' + e.message, 'error');
  }
}

/** 切换金额展示单位（规则阈值始终按人民币配置与比较，仅影响展示与告警消息） */
async function saveCurrencyMode() {
  try {
    const r = await fetch('/api/monitor/currency-config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: overview.currencyMode }),
    });
    const j = await r.json();
    if (r.ok && j.ok) {
      showToast(j.message || '已切换金额单位', 'success');
      await loadOverview();
      await loadAlerts();
      loadTrend(selectedShop.value, selectedMetric.value);
    } else {
      showToast(j.message || '切换失败', 'error');
      await loadOverview(); // 还原服务端生效值
    }
  } catch (e) {
    showToast('本地服务异常：' + e.message, 'error');
  }
}

function selectShop(shopId) {
  selectedShop.value = shopId || '';
  loadTrend(selectedShop.value, selectedMetric.value);
}

function selectMetric(metric) {
  selectedMetric.value = metric;
  loadTrend(selectedShop.value, metric);
}

// ---------- 规则面板 ----------
function openRules() {
  ruleEdits.value = rules.value.map((r) => ({
    id: r.id,
    title: r.title,
    unit: (overview.metrics[r.metric] || {}).unit || r.unit || '',
    enabled: r.enabled !== false,
    p2: r.thresholds && typeof r.thresholds.p2 === 'number' ? r.thresholds.p2 : null,
    p1: r.thresholds && typeof r.thresholds.p1 === 'number' ? r.thresholds.p1 : null,
    p0: r.thresholds && typeof r.thresholds.p0 === 'number' ? r.thresholds.p0 : null,
  }));
  rulesDrawer.value = true;
}

async function saveRules() {
  savingRules.value = true;
  try {
    const overrides = {};
    for (const e of ruleEdits.value) {
      const th = {};
      for (const k of ['p2', 'p1', 'p0']) {
        if (e[k] !== '' && e[k] !== null) {
          const n = Number(e[k]);
          if (isFinite(n)) th[k] = n;
        }
      }
      overrides[e.id] = { enabled: e.enabled, thresholds: th };
    }
    const r = await fetch('/api/monitor/rules', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ overrides }),
    });
    const j = await r.json();
    if (r.ok && j.ok) {
      showToast('规则已保存并生效', 'success');
      rulesDrawer.value = false;
      await loadRules();
      loadOverview();
    } else showToast(j.message || '保存失败', 'error');
  } catch (e) {
    showToast('本地服务异常：' + e.message, 'error');
  } finally {
    savingRules.value = false;
  }
}

// ---------- 监控店铺配置面板 ----------
/** 按关键词过滤（店铺名 / 店铺ID，大小写不敏感，空格分隔多关键词需同时命中） */
const shownShopConfig = computed(() => {
  const kws = shopSearch.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!kws.length) return shopConfig.value;
  return shopConfig.value.filter((s) => {
    const hay = `${s.name || ''} ${s.shopId}`.toLowerCase();
    return kws.every((k) => hay.includes(k));
  });
});

const monitoredCount = computed(() => shopConfig.value.filter((s) => s.monitored).length);

async function openShopsConfig() {
  try {
    const r = await fetch('/api/monitor/shops-config');
    const j = await r.json();
    if (j && j.ok) {
      shopConfig.value = (j.shops || []).map((s) => Object.assign({}, s));
      shopSearch.value = '';
      shopsDrawer.value = true;
    } else showToast(j.message || '读取失败', 'error');
  } catch (e) {
    showToast('本地服务异常：' + e.message, 'error');
  }
}

/** 勾选/取消当前列表（无搜索词时作用于全部店铺，有搜索词时只作用于匹配项） */
function setAllMonitored(v) {
  for (const s of shownShopConfig.value) s.monitored = v;
}

async function saveShopsConfig() {
  savingShops.value = true;
  try {
    const excludedShopIds = shopConfig.value.filter((s) => !s.monitored).map((s) => s.shopId);
    const r = await fetch('/api/monitor/shops-config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ excludedShopIds }),
    });
    const j = await r.json();
    if (r.ok && j.ok) {
      showToast('监控店铺配置已保存', 'success');
      shopsDrawer.value = false;
      await loadOverview();
      await loadAlerts();
    } else showToast(j.message || '保存失败', 'error');
  } catch (e) {
    showToast('本地服务异常：' + e.message, 'error');
  } finally {
    savingShops.value = false;
  }
}

// ---------- SSE 与轮播 ----------
function onSseEvent(ev) {
  if (!ev || typeof ev !== 'object') return;
  if (ev.type === 'alert') {
    upsertAlert(ev.data);
    if (ev.data && ev.data.change === 'new' && ev.data.level === 'P0' && ev.data.status === 'open') {
      flash(ev.data.id);
      beep(2);
    } else if (ev.data && (ev.data.change === 'new' || ev.data.change === 'escalate')) {
      flash(ev.data.id);
      if (ev.data.change === 'escalate') beep(1);
    }
    refreshSoon();
  } else if (ev.type === 'collection') {
    refreshSoon();
  } else if (ev.type === 'rules') {
    loadRules();
    refreshSoon();
  } else if (ev.type === 'config') {
    // 其他页面修改了监控店铺配置或金额单位：同步刷新总览/告警/趋势
    loadOverview();
    loadAlerts();
    loadTrend(selectedShop.value, selectedMetric.value);
  }
}

function connectSse() {
  if (es) { try { es.close(); } catch { /* 忽略 */ } }
  es = new EventSource('/api/monitor/events');
  es.onopen = () => { sseOk.value = true; };
  es.onerror = () => { sseOk.value = false; };
  es.onmessage = (m) => {
    try { onSseEvent(JSON.parse(m.data)); } catch { /* 忽略无法解析的事件 */ }
  };
}

function rotate() {
  const pool = sortedShops.value;
  if (!pool.length) return;
  const withAlerts = pool.filter((s) => s.alerts.maxLevel);
  const list = withAlerts.length ? withAlerts : pool;
  const idx = list.findIndex((s) => s.shopId === selectedShop.value);
  selectShop(list[(idx + 1) % list.length].shopId);
}

function applyRotate() {
  clearInterval(rotateTimer);
  if (projectMode.value && rotateOn.value) rotateTimer = setInterval(rotate, 20000);
}

watch([projectMode, rotateOn], applyRotate);

// ---------- 在场心跳（按需采集：仅本页可见时采集，离开即停） ----------
const PRESENCE_HEARTBEAT_MS = 30 * 1000;
let tabActive = window.parent === window; // 直接打开本页（非门户 iframe）时默认视为可见
let hasParentReply = false;
let presenceTimer = null;
let parentTimer = null;

function sendPresence(active) {
  try {
    fetch('/api/monitor/presence', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active }),
    }).catch(() => { /* 服务暂不可用时忽略，下个心跳重试 */ });
  } catch { /* 忽略 */ }
}

function startPresence() {
  if (presenceTimer) clearInterval(presenceTimer);
  sendPresence(true); // 立即报告在场（服务端会立刻巡检一轮）
  presenceTimer = setInterval(() => sendPresence(true), PRESENCE_HEARTBEAT_MS);
}

function stopPresence() {
  if (presenceTimer) { clearInterval(presenceTimer); presenceTimer = null; }
  sendPresence(false); // 离开即停采
}

/** 按「门户当前 Tab + 页面可见性」同步在场状态 */
function syncPresence() {
  if (tabActive && document.visibilityState !== 'hidden') startPresence();
  else stopPresence();
}

function onParentMessage(ev) {
  if (!ev || !ev.data) return;
  if (ev.data.type === 'portal-tab') {
    hasParentReply = true;
    tabActive = ev.data.key === 'monitor';
    syncPresence();
  }
}

function onVisibilityChange() {
  syncPresence();
}

// ---------- 生命周期 ----------
onMounted(async () => {
  // Element Plus 深色主题（本页为 iframe 内独立 document，弹层/控件跟随暗色变量）
  document.documentElement.classList.add('dark');
  window.addEventListener('resize', onWinResize);
  await loadOverview();
  await loadAlerts();
  await loadRules();
  const firstAlert = sortedShops.value.find((s) => s.alerts.maxLevel) || sortedShops.value[0];
  if (firstAlert) selectShop(firstAlert.shopId);
  connectSse();
  // 在场心跳：门户 iframe 内先询问当前激活 Tab（避免「刚打开又立刻切走」误报在场）；
  // 没有父窗口（直接访问本页）则立即视为在场
  window.addEventListener('message', onParentMessage);
  document.addEventListener('visibilitychange', onVisibilityChange);
  if (window.parent !== window) {
    try { window.parent.postMessage({ type: 'monitor-ready' }, location.origin || '*'); } catch { /* 忽略 */ }
    parentTimer = setTimeout(() => {
      if (!hasParentReply) { tabActive = true; syncPresence(); }
    }, 1500);
  } else {
    syncPresence();
  }
  // 30s 兜底轮询（SSE 断开时数据不落后太多）+ 时钟
  setInterval(() => {
    if (!sseOk.value) { loadOverview(); loadAlerts(); }
  }, 30000);
  setInterval(() => { now.value = Date.now(); }, 1000);
  applyRotate();
});

onUnmounted(() => {
  if (es) { try { es.close(); } catch { /* 忽略 */ } }
  clearInterval(rotateTimer);
  stopPresence();
  if (parentTimer) clearTimeout(parentTimer);
  if (chart) { chart.dispose(); chart = null; }
  window.removeEventListener('resize', onWinResize);
  window.removeEventListener('message', onParentMessage);
  document.removeEventListener('visibilitychange', onVisibilityChange);
  document.documentElement.classList.remove('dark');
});
</script>

<template>
  <div class="dash" :class="{ proj: projectMode }">
    <!-- ===== 顶栏：统计卡 + 控制 ===== -->
    <header class="top">
      <div class="title">
        <span class="logo">S</span>
        <div>
          <b>虾皮跨境店监控大屏</b>
          <small>多店巡检 · 三级告警 · 数据仅存本机</small>
        </div>
      </div>
      <div class="stats">
        <div class="stat"><b>{{ overview.shops.length }}</b><span>店铺</span></div>
        <div class="stat p0" :class="{ pulse: overview.totals.P0 > 0 }"><b>{{ overview.totals.P0 }}</b><span>P0 紧急</span></div>
        <div class="stat p1"><b>{{ overview.totals.P1 }}</b><span>P1 重要</span></div>
        <div class="stat p2"><b>{{ overview.totals.P2 }}</b><span>P2 提醒</span></div>
        <div class="stat ok"><b>{{ normalCount }}</b><span>正常</span></div>
        <div v-if="overview.excludedCount > 0" class="stat dim clickable" @click="openShopsConfig" title="已授权但未启用监控的店铺数，点击配置">
          <b>{{ overview.excludedCount }}</b><span>未监控</span>
        </div>
        <div v-if="reAuthCount > 0" class="stat reauth"><b>{{ reAuthCount }}</b><span>待重新授权</span></div>
      </div>
      <div class="controls">
        <span class="ctl" title="金额指标展示单位（告警规则阈值始终按人民币配置与比较）">金额
          <el-select v-model="overview.currencyMode" size="small" class="cur-sel" @change="saveCurrencyMode">
            <el-option label="当地货币" value="local" />
            <el-option label="人民币" value="rmb" />
          </el-select>
        </span>
        <span class="ctl" title="投屏/展示模式"><el-switch v-model="projectMode" size="small" />投影</span>
        <span class="ctl" title="P0 告警声音提醒"><el-switch v-model="soundOn" size="small" />声音</span>
        <span class="ctl" title="投影模式下每 20 秒轮换店铺"><el-switch v-model="rotateOn" size="small" />轮播</span>
        <el-button size="small" title="立即采集所选店铺（未选择时全部店铺）" @click="manualCollect">立即采集</el-button>
        <el-button size="small" title="勾选哪些已授权店铺需要监控（未勾选的不采集、不进大屏）" @click="openShopsConfig">监控店铺</el-button>
        <el-button size="small" @click="openRules">告警规则</el-button>
      </div>
      <div class="clock">
        <b>{{ fmtClock(now) }}</b>
        <small :class="{ on: sseOk }">{{ sseOk ? '实时推送' : '轮询中' }}</small>
      </div>
    </header>

    <!-- 授权失效横幅：这些店铺已暂停采集，重新授权后自动恢复 -->
    <div v-if="reAuthCount > 0" class="reauth-banner">
      <span class="rb-ico">⚠</span>
      <span><b>{{ reAuthCount }}</b> 家店铺的开放平台授权已失效（主账号共享 token 被刷新绑定或已过期），已自动暂停这些店铺的采集。
        到「开放平台」页用<b>主账号重新授权一次</b>即可全部恢复，无需逐店操作。</span>
      <el-button type="danger" size="small" class="rb-btn" @click="goOpenapi">去重新授权</el-button>
    </div>

    <div v-if="!overview.configured || !overview.shops.length" class="empty">
      <el-empty :image-size="110">
        <template #description>
          <template v-if="!overview.configured">
            <h2>尚未配置开放平台 App</h2>
            <p>请先到门户页「开放平台」Tab 完成 App 配置与店铺授权，本大屏会自动开始巡检采集。</p>
          </template>
          <template v-else-if="overview.excludedCount > 0">
            <h2>当前没有启用监控的店铺</h2>
            <p>已授权 {{ overview.excludedCount }} 家店铺，但都被停用了监控。请在「监控店铺」中勾选需要巡检的店铺。</p>
          </template>
          <template v-else>
            <h2>当前没有已授权店铺</h2>
            <p>请先到门户页「开放平台」Tab 完成 App 配置与店铺授权，本大屏会自动开始巡检采集。</p>
          </template>
        </template>
        <el-button v-if="overview.configured && overview.excludedCount > 0" type="primary" size="small" @click="openShopsConfig">
          配置监控店铺
        </el-button>
      </el-empty>
      <p class="dim2">授权后无需任何额外设置：打开本页即开始按需巡检（订单履约 10 分钟 / 商品库存 30 分钟 / 账户健康·广告·资金·售后评价 60 分钟），离开本页自动暂停采集。</p>
    </div>

    <!-- ===== 主体三栏 ===== -->
    <main v-else class="grid">
      <!-- 左：店铺健康墙 -->
      <aside class="panel shops">
        <h3>店铺健康墙 <small>按告警级别自动置顶</small></h3>
        <div class="shop-list">
          <div
            v-for="s in sortedShops"
            :key="s.shopId"
            class="shop-card"
            :class="['lv-' + (s.authBroken ? 'reauth' : s.alerts.maxLevel || 'ok'), { selected: s.shopId === selectedShop }, { flashing: s.alerts.maxLevel === 'P0' && !s.authBroken }]"
            @click="selectShop(s.shopId)"
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

      <!-- 中：趋势 + 矩阵 -->
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
                @click="selectMetric(c.id)"
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
                <tr v-for="s in sortedShops" :key="s.shopId" :class="{ selected: s.shopId === selectedShop }">
                  <td class="rowhead" @click="selectShop(s.shopId)">{{ shopName(s) }}</td>
                  <td
                    v-for="m in s.matrix"
                    :key="m.metric"
                    class="cell"
                    :class="{ 'cell-fail': failInfo(s, m.metric) }"
                    :style="{ background: m.level ? LEVEL_COLOR[m.level] + '33' : 'rgba(255,255,255,0.03)', color: m.level ? LEVEL_COLOR[m.level] : '#9aa3b5' }"
                    :title="cellTitle(s, m)"
                    @click="selectShop(s.shopId); selectMetric(m.metric)"
                  >{{ m.v === null ? '—' : m.v }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <!-- 右：告警流 -->
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
          <div v-if="!shownAlerts.length" class="alert-empty">暂无告警，一切正常 🎉</div>
          <div
            v-for="a in shownAlerts"
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
                <span class="ai-shop">{{ shopName(overview.shops.find((s) => s.shopId === a.shopId)) }}</span>
                <span class="ai-time">{{ fmtTime(a.lastAt) }}</span>
              </div>
              <div class="ai-msg">
                {{ a.message }}
                <i v-if="a.count > 1" class="ai-count">×{{ a.count }}</i>
                <i v-if="a.status === 'recovered'" class="ai-recovered">✓ 已恢复</i>
                <i v-else-if="a.status === 'ack'" class="ai-ack">已确认</i>
              </div>
              <div v-if="a.status === 'open' || a.status === 'ack'" class="ai-ops">
                <el-button v-if="a.status === 'open'" size="small" @click="alertAction(a, 'ack')">确认</el-button>
                <el-button size="small" type="danger" plain @click="alertAction(a, 'close')">关闭</el-button>
              </div>
            </div>
          </div>
        </div>
      </aside>
    </main>

    <!-- ===== 底部：跑马灯 + 采集状态 ===== -->
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

    <!-- ===== 规则编辑抽屉（728px：560 放大 30%，避免规则表格出现横向滚动条） ===== -->
    <el-drawer v-model="rulesDrawer" title="告警规则（阈值修改后立即生效）" size="728px" direction="rtl">
      <p class="dim2">值越大越严重（店铺评分为「越小越严重」）。留空的级别不触发。金额类规则阈值<b>一律按人民币</b>填写与比较（大屏展示可切换当地货币/人民币，告警自动换算）。</p>
      <el-table :data="ruleEdits" size="small" border class="rule-table">
        <el-table-column label="启用" width="60" align="center">
          <template #default="{ row }"><el-switch v-model="row.enabled" size="small" /></template>
        </el-table-column>
        <el-table-column label="规则" min-width="170">
          <template #default="{ row }">{{ row.title }}<i v-if="row.unit" class="dim2">（{{ row.unit }}）</i></template>
        </el-table-column>
        <el-table-column label="P2 提醒" width="112">
          <template #default="{ row }">
            <el-input-number v-model="row.p2" :controls="false" size="small" placeholder="不触发" class="num" :class="{ p2c: row.p2 !== null }" />
          </template>
        </el-table-column>
        <el-table-column label="P1 重要" width="112">
          <template #default="{ row }">
            <el-input-number v-model="row.p1" :controls="false" size="small" placeholder="不触发" class="num" :class="{ p1c: row.p1 !== null }" />
          </template>
        </el-table-column>
        <el-table-column label="P0 紧急" width="112">
          <template #default="{ row }">
            <el-input-number v-model="row.p0" :controls="false" size="small" placeholder="不触发" class="num" :class="{ p0c: row.p0 !== null }" />
          </template>
        </el-table-column>
      </el-table>
      <div class="drawer-ops">
        <el-button @click="rulesDrawer = false">取消</el-button>
        <el-button type="primary" :loading="savingRules" @click="saveRules">保存</el-button>
      </div>
    </el-drawer>

    <!-- ===== 监控店铺配置抽屉 ===== -->
    <el-drawer v-model="shopsDrawer" title="监控店铺配置" size="560px" direction="rtl">
      <p class="dim2">
        已授权的店铺默认全部监控；取消勾选的店铺<b>不再巡检采集、不出现在大屏</b>，其未关闭的告警会自动关闭。
        重新勾选后立即恢复采集，历史快照与告警记录仍保留。
      </p>
      <div class="shopcfg-search-row">
        <el-input
          v-model="shopSearch"
          class="shopcfg-search"
          size="small"
          clearable
          placeholder="搜索店铺名 / 店铺ID（空格分隔多关键词）"
          @keydown.esc="shopSearch = ''"
        />
        <span class="dim2 scfg-sum">{{ monitoredCount }} / {{ shopConfig.length }} 家监控中</span>
      </div>
      <div class="shopcfg-ops">
        <el-button size="small" @click="setAllMonitored(true)">
          {{ shopSearch.trim() ? '匹配项全部监控' : '全部监控' }}
        </el-button>
        <el-button size="small" @click="setAllMonitored(false)">
          {{ shopSearch.trim() ? '匹配项全部停用' : '全部停用' }}
        </el-button>
        <span v-if="shopSearch.trim()" class="dim2">当前操作只作用于 {{ shownShopConfig.length }} 家匹配店铺</span>
      </div>
      <div class="shopcfg-list">
        <label v-for="s in shownShopConfig" :key="s.shopId" class="shopcfg-row">
          <el-switch v-model="s.monitored" size="small" />
          <span class="scfg-name">{{ s.name || '店铺…' + String(s.shopId).slice(-4) }}</span>
          <i v-if="s.authBroken" class="b-reauth" title="授权已失效，重新授权后自动恢复采集">待重新授权</i>
          <i v-else class="scfg-state" :class="{ on: s.monitored }">{{ s.monitored ? '监控中' : '不监控' }}</i>
          <span class="scfg-id">{{ s.shopId }}</span>
        </label>
        <div v-if="!shopConfig.length" class="dim2">暂无已授权店铺，请先在「开放平台」Tab 完成 App 配置与店铺授权。</div>
        <div v-else-if="!shownShopConfig.length" class="dim2">没有匹配「{{ shopSearch }}」的店铺，换个关键词试试。</div>
      </div>
      <div class="drawer-ops">
        <el-button @click="shopsDrawer = false">取消</el-button>
        <el-button type="primary" :loading="savingShops" @click="saveShopsConfig">保存</el-button>
      </div>
    </el-drawer>
  </div>
</template>

<style scoped>
* { box-sizing: border-box; }
/* 只重置自定义元素的边距；不能用 scoped `* { padding: 0 }`，会命中 Element Plus 组件
   根节点（如 .el-button），把按钮自带的左右内边距清零导致文字贴边 */
.dash, h2, h3, p { margin: 0; padding: 0; }
.dash {
  font-family: "Microsoft YaHei", "PingFang SC", -apple-system, "Segoe UI", sans-serif;
  background: #0b0e17;
  color: #e6e9f2;
  height: 100vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
/* ===== 顶栏 ===== */
.top {
  display: flex;
  align-items: center;
  gap: 18px;
  padding: 10px 16px;
  background: #111527;
  border-bottom: 1px solid #1e2440;
  flex-wrap: wrap;
}
.title { display: flex; align-items: center; gap: 10px; }
.logo {
  width: 36px; height: 36px; border-radius: 9px;
  background: #ee4d2d; color: #fff;
  display: flex; align-items: center; justify-content: center;
  font-size: 18px; font-weight: 700;
}
.title b { font-size: 16px; display: block; }
.title small { font-size: 11px; color: #7d86a0; }
.stats { display: flex; gap: 8px; flex: 1; justify-content: center; }
.stat {
  background: #171b2e; border: 1px solid #232a4a; border-radius: 8px;
  padding: 5px 14px; text-align: center; min-width: 64px;
}
.stat b { font-size: 20px; display: block; line-height: 1.15; }
.stat span { font-size: 11px; color: #8a93ad; }
.stat.p0 b { color: #FF3B30; } .stat.p1 b { color: #FF9500; } .stat.p2 b { color: #FFD60A; }
.stat.ok b { color: #30D158; } .stat.dim b { color: #5b6272; }
.stat.reauth b { color: #8f95a8; }
.stat.p0.pulse { animation: cardPulse 1.6s ease-in-out infinite; }
/* 授权失效横幅 */
.reauth-banner {
  display: flex; align-items: center; gap: 12px;
  background: #2a2410; border-bottom: 1px solid #4d3c14;
  color: #ffd97a; font-size: 13px; line-height: 1.6;
  padding: 8px 16px;
}
.reauth-banner .rb-ico { font-size: 18px; flex: none; }
.reauth-banner b { color: #ffb340; }
.rb-btn { margin-left: auto; flex: none; }
@keyframes cardPulse {
  0%, 100% { box-shadow: 0 0 0 0 rgba(255, 59, 48, 0.5); }
  50% { box-shadow: 0 0 16px 3px rgba(255, 59, 48, 0.55); }
}
.controls { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
.ctl { font-size: 12px; color: #aab2c8; display: flex; gap: 5px; align-items: center; white-space: nowrap; }
.cur-sel { width: 110px; }
/* EP 按钮横向留白：恢复默认后再略加宽，避免文字贴着两侧边 */
.controls .el-button, .ai-ops .el-button, .drawer-ops .el-button, .shopcfg-ops .el-button {
  padding-left: 14px;
  padding-right: 14px;
}
.clock { text-align: right; }
.clock b { font-size: 19px; font-variant-numeric: tabular-nums; display: block; }
.clock small { font-size: 10px; color: #7d86a0; }
.clock small.on { color: #30D158; }
/* ===== 空态 ===== */
.empty {
  flex: 1; display: flex; flex-direction: column; gap: 10px;
  align-items: center; justify-content: center; text-align: center; padding: 0 40px;
}
.empty h2 { color: #FF9500; font-size: 20px; }
.empty p { color: #aab2c8; max-width: 560px; line-height: 1.7; }
.dim2 { color: #7d86a0; font-size: 12px; }
/* ===== 主体 ===== */
.grid {
  flex: 1; display: grid; min-height: 0;
  /* 中间列用 minmax(0,1fr)：19 列矩阵内容很宽，允许中间列收缩、矩阵在面板内横向滚动，
     否则 1fr 的自动最小宽度会撑爆网格，把右侧告警流挤出屏幕 */
  grid-template-columns: 300px minmax(0, 1fr) 360px;
  gap: 10px; padding: 10px;
}
.panel {
  background: #111527; border: 1px solid #1e2440; border-radius: 10px;
  display: flex; flex-direction: column; min-height: 0; overflow: hidden;
  min-width: 0; /* 允许面板收缩到网格列宽以内（内容由内部滚动容器消化） */
}
.panel > h3 {
  font-size: 13px; padding: 10px 12px 8px; color: #dfe3f2;
  border-bottom: 1px solid #1e2440; flex: none;
}
.panel > h3 small { color: #7d86a0; font-weight: 400; font-size: 11px; margin-left: 6px; }
/* 店铺墙 */
.shop-list { overflow-y: auto; padding: 8px; display: flex; flex-direction: column; gap: 8px; min-height: 0; }
.shop-card {
  background: #171b2e; border: 1px solid #232a4a; border-left-width: 3px;
  border-radius: 8px; padding: 8px 10px; cursor: pointer; transition: all 0.15s;
  flex: none; /* 卡片不随列表高度压缩，溢出交给列表滚动 */
}
.shop-card:hover { background: #1c2140; }
.shop-card.selected { outline: 1px solid #4a5bd8; }
.shop-card.lv-P0 { border-left-color: #FF3B30; background: rgba(255, 59, 48, 0.07); }
.shop-card.lv-P1 { border-left-color: #FF9500; }
.shop-card.lv-P2 { border-left-color: #FFD60A; }
.shop-card.lv-ok { border-left-color: #30D158; }
.shop-card.lv-reauth { border-left-color: #8f95a8; opacity: 0.8; }
.shop-card.flashing { animation: cardFlash 1.4s ease-in-out infinite; }
@keyframes cardFlash {
  0%, 100% { box-shadow: 0 0 0 0 rgba(255, 59, 48, 0); }
  50% { box-shadow: 0 0 14px 2px rgba(255, 59, 48, 0.6); }
}
.sc-head { display: flex; align-items: center; gap: 6px; }
.dot { width: 8px; height: 8px; border-radius: 50%; flex: none; }
.sc-name { font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sc-badges { margin-left: auto; display: flex; gap: 3px; flex: none; }
.sc-badges i { font-style: normal; font-size: 10px; padding: 1px 5px; border-radius: 4px; }
.b-P0 { background: #FF3B30; color: #fff; }
.b-P1 { background: #FF9500; color: #111; }
.b-P2 { background: #FFD60A; color: #111; }
.b-ok { background: rgba(48, 209, 88, 0.2); color: #30D158; }
.b-reauth { background: rgba(143, 149, 168, 0.25); color: #aab2c8; }
.sc-foot { display: flex; gap: 10px; margin-top: 6px; font-size: 10px; color: #6d7690; flex-wrap: wrap; }
.sc-foot span.bad, .sc-foot .fail { color: #FF3B30; }
.sc-foot span.off { color: #4a5162; }
/* 中间列 */
.center { display: flex; flex-direction: column; gap: 10px; min-height: 0; min-width: 0; }
.trend-panel { flex: 0.8; }
.tp-head { display: flex; gap: 8px; align-items: center; padding: 8px 12px; flex: none; }
.tp-shop {
  flex: none; max-width: 200px; font-size: 12px; font-weight: 600; color: #dfe3f2;
  background: #171b2e; border: 1px solid #232a4a; border-radius: 6px; padding: 5px 10px;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.tp-fail {
  flex: none; font-style: normal; font-size: 11px; color: #FF3B30;
  background: rgba(255, 59, 48, 0.12); border: 1px solid rgba(255, 59, 48, 0.45);
  border-radius: 6px; padding: 4px 8px; white-space: nowrap;
}
.chips { display: flex; gap: 6px; overflow-x: auto; flex: 1; }
.chips button {
  background: #171b2e; color: #aab2c8; border: 1px solid #232a4a; border-radius: 6px;
  padding: 4px 10px; font-size: 11px; white-space: nowrap; cursor: pointer; font-family: inherit;
}
.chips button.active { background: #2b3560; color: #fff; border-color: #4a5bd8; }
.chart { flex: 1; min-height: 0; width: 100%; padding: 4px 8px 8px; }
.chart-empty {
  flex: 1; display: flex; align-items: center; justify-content: center;
  color: #6d7690; font-size: 12px; padding: 20px; text-align: center;
}
.matrix-panel { flex: 1; }
.matrix-wrap { overflow: auto; padding: 8px 10px; }
.matrix { border-collapse: collapse; width: 100%; font-size: 12px; }
.matrix th, .matrix td { border: 1px solid #1c2140; padding: 4px 8px; text-align: center; white-space: nowrap; }
.matrix th { background: #171b2e; color: #8a93ad; font-weight: 400; font-size: 11px; }
.matrix .rowhead { background: #171b2e; color: #aab2c8; text-align: left; max-width: 150px; overflow: hidden; text-overflow: ellipsis; cursor: pointer; }
.matrix tr.selected td { outline: 1px solid #4a5bd8; outline-offset: -1px; }
.matrix td.cell { cursor: pointer; font-variant-numeric: tabular-nums; }
.matrix td.cell:hover { filter: brightness(1.5); }
/* 采集失败标记：红色内框 + 右上角 ✗ */
.matrix td.cell-fail { position: relative; box-shadow: inset 0 0 0 1px rgba(255, 59, 48, 0.65); }
.matrix td.cell-fail::after {
  content: '✗'; position: absolute; top: 1px; right: 2px;
  font-size: 8px; line-height: 1; color: #FF3B30;
}
/* 告警流 */
.alerts { min-width: 0; }
.filter { display: flex; gap: 6px; padding: 8px 10px; flex: none; }
.alert-list { overflow-y: auto; padding: 0 10px 10px; display: flex; flex-direction: column; gap: 8px; min-height: 0; }
.alert-empty { color: #30D158; text-align: center; padding: 30px 0; font-size: 13px; }
.alert-item {
  display: flex; background: #171b2e; border: 1px solid #232a4a; border-radius: 8px;
  overflow: hidden; transition: opacity 0.2s;
  flex: none; /* 条目不随列表高度压缩，避免「确认/关闭」按钮被裁掉；溢出交给列表滚动 */
}
.ai-bar { width: 4px; flex: none; }
.alert-item.recovered { opacity: 0.55; }
.alert-item.ack { opacity: 0.75; }
.alert-item.flashing { animation: itemFlash 1s ease-in-out 3; }
@keyframes itemFlash {
  0%, 100% { box-shadow: 0 0 0 0 rgba(255, 59, 48, 0); }
  50% { box-shadow: 0 0 12px 2px rgba(255, 59, 48, 0.55); }
}
.ai-body { flex: 1; padding: 7px 9px; min-width: 0; }
.ai-head { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.ai-level { font-style: normal; font-size: 10px; padding: 1px 6px; border-radius: 4px; color: #111; font-weight: 700; }
.ai-head b { font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
.ai-shop { font-size: 10px; color: #7d86a0; background: #1d2340; padding: 1px 6px; border-radius: 4px; }
.ai-time { margin-left: auto; font-size: 10px; color: #6d7690; }
.ai-msg { font-size: 11px; color: #aab2c8; margin-top: 4px; line-height: 1.5; }
.ai-count { font-style: normal; color: #FF9500; margin-left: 4px; font-weight: 700; }
.ai-recovered { font-style: normal; color: #30D158; margin-left: 6px; }
.ai-ack { font-style: normal; color: #8a93ad; margin-left: 6px; }
.ai-ops { margin-top: 6px; display: flex; gap: 6px; }
/* 底部 */
.foot {
  display: flex; gap: 10px; padding: 8px 16px;
  background: #111527; border-top: 1px solid #1e2440; flex-wrap: wrap;
}
.ticker-wrap { flex: 1; overflow: hidden; min-width: 200px; }
.ticker { white-space: nowrap; font-size: 12px; color: #FF9500; }
.ticker.anim { animation: ticker 24s linear infinite; }
.ticker-seg { display: inline-block; }
@keyframes ticker {
  0% { transform: translateX(0); }
  100% { transform: translateX(-50%); }
}
.coll-strip { display: flex; gap: 8px; overflow-x: auto; }
.cs-item {
  font-size: 10px; color: #7d86a0; background: #171b2e; border: 1px solid #232a4a;
  border-radius: 6px; padding: 3px 8px; white-space: nowrap;
}
.cs-item i { font-style: normal; margin-left: 4px; }
.cs-item.bad { border-color: #FF3B30; color: #FF3B30; }
/* 抽屉 */
.rule-table { margin-top: 6px; }
.rule-table .num { width: 100%; }
/* 阈值输入框按级别描边（留空 = 不触发） */
.rule-table .p2c :deep(.el-input__wrapper) { box-shadow: 0 0 0 1px #FFD60A inset; }
.rule-table .p1c :deep(.el-input__wrapper) { box-shadow: 0 0 0 1px #FF9500 inset; }
.rule-table .p0c :deep(.el-input__wrapper) { box-shadow: 0 0 0 1px #FF3B30 inset; }
.drawer-ops { display: flex; gap: 10px; justify-content: flex-end; margin-top: 12px; }
/* 监控店铺配置 */
.stat.clickable { cursor: pointer; }
.stat.clickable:hover { border-color: #4a5bd8; background: #1c2140; }
.shopcfg-ops { display: flex; gap: 8px; align-items: center; margin-top: 10px; }
.shopcfg-search-row { display: flex; gap: 8px; align-items: center; margin-top: 4px; }
.shopcfg-search { flex: 1; min-width: 0; }
.scfg-sum { flex: none; white-space: nowrap; }
.shopcfg-list {
  flex: 1; min-height: 0; overflow-y: auto; display: flex; flex-direction: column; gap: 6px;
  border: 1px solid #1e2440; border-radius: 8px; padding: 8px; margin-top: 10px;
}
.shopcfg-row {
  display: flex; align-items: center; gap: 8px;
  background: #171b2e; border: 1px solid #232a4a; border-radius: 7px;
  padding: 7px 10px; cursor: pointer; font-size: 12px;
}
.shopcfg-row:hover { background: #1c2140; }
.scfg-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.scfg-state { font-style: normal; font-size: 10px; color: #7d86a0; background: #1d2340; padding: 1px 6px; border-radius: 4px; flex: none; }
.scfg-state.on { color: #30D158; background: rgba(48, 209, 88, 0.15); }
.scfg-id { font-size: 10px; color: #6d7690; flex: none; font-variant-numeric: tabular-nums; }
/* 投影模式：字号放大 */
.proj { font-size: 15px; }
.proj .shop-card { padding: 10px 12px; }
.proj .sc-name { font-size: 15px; }
.proj .matrix { font-size: 14px; }
.proj .ai-head b { font-size: 14px; }
.proj .ai-msg { font-size: 13px; }
</style>
