<script setup>
// 虾皮多店监控大屏（一期）
// 数据流：GET /api/monitor/overview（总览+矩阵定级）/alerts（告警流）/trend（趋势）/rules（规则）
//         + /api/monitor/events SSE 实时推送（告警变更/采集结果，迟到回放），30s 兜底轮询。
// 告警只在本页展示（本期不接 IM）：P0 红色脉冲置顶 + 声音提醒，P1 橙色，P2 黄色。
import { ref, reactive, computed, watch, onMounted, onUnmounted } from 'vue';

const LEVEL_COLOR = { P0: '#FF3B30', P1: '#FF9500', P2: '#FFD60A' };
const LEVEL_NAME = { P0: '紧急', P1: '重要', P2: '提醒' };
const OK_COLOR = '#30D158';
const MATRIX_METRICS = [
  'order.pending_24h', 'firstmile.unbound', 'product.out_of_stock', 'product.low_stock',
  'product.violations', 'health.late_shipment_rate', 'health.non_fulfilment_rate', 'health.rating',
];
const DOMAIN_LABEL = { order: '订单', product: '商品', health: '健康' };

// ---------- 状态 ----------
const overview = reactive({
  configured: false,
  scheduler: { running: false, active: 0, lastTickAt: 0 },
  totals: { P0: 0, P1: 0, P2: 0, recovered: 0 },
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
const toastMsg = ref('');
const rulesDrawer = ref(false);
const ruleEdits = ref([]);
const savingRules = ref(false);
const now = ref(Date.now());

let es = null;
let toastTimer = null;
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

const tickerText = computed(() => openTopAlerts.value
  .map((a) => `【${a.level}】${shopName(overview.shops.find((s) => s.shopId === a.shopId))} ${a.title}：${a.message}`)
  .join('　·　'));

const metricChips = computed(() => MATRIX_METRICS.map((id) => Object.assign({ id }, overview.metrics[id] || { title: id, unit: '' })));

const selectedShopObj = computed(() => overview.shops.find((s) => s.shopId === selectedShop.value) || null);

// ---------- 趋势图几何计算（SVG 自绘，零依赖） ----------
function levelOfValue(metric, th, v) {
  if (th == null || v == null) return null;
  const dir = (metric && metric.direction) || 'up';
  const hit = (t) => typeof t === 'number' && (dir === 'up' ? v >= t : v <= t);
  if (hit(th.p0)) return 'P0';
  if (hit(th.p1)) return 'P1';
  if (hit(th.p2)) return 'P2';
  return null;
}

const chartView = computed(() => {
  const pts = trend.points || [];
  const w = 860;
  const h = 240;
  const pad = { l: 52, r: 14, t: 14, b: 26 };
  const base = {
    viewBox: `0 0 ${w} ${h}`,
    w, h, pad,
    gridY: [], thresholdLines: [], xLabels: [],
    area: '', line: '', dots: [], last: null,
  };
  if (!pts.length) return base;
  const th = trend.thresholds || {};
  const vals = pts.map((p) => p.v);
  const thVals = Object.values(th).filter((x) => typeof x === 'number');
  let min = Math.min(...vals, ...thVals);
  let max = Math.max(...vals, ...thVals);
  if (min === max) { min -= 1; max += 1; }
  const span = max - min;
  min -= span * 0.12; max += span * 0.12;
  const X = (i) => pad.l + (pts.length === 1 ? (w - pad.l - pad.r) / 2 : (i / (pts.length - 1)) * (w - pad.l - pad.r));
  const Y = (v) => pad.t + (1 - (v - min) / (max - min)) * (h - pad.t - pad.b);
  for (let i = 0; i <= 3; i++) {
    const v = min + ((max - min) * i) / 3;
    base.gridY.push({ y: Y(v), label: v >= 100 ? String(Math.round(v)) : String(Math.round(v * 10) / 10) });
  }
  const thMeta = [
    { key: 'p0', color: '#FF3B30', label: 'P0 阈值' },
    { key: 'p1', color: '#FF9500', label: 'P1 阈值' },
    { key: 'p2', color: '#FFD60A', label: 'P2 阈值' },
  ];
  for (const t of thMeta) {
    if (typeof th[t.key] === 'number') {
      base.thresholdLines.push({ y: Y(th[t.key]), color: t.color, label: t.label });
    }
  }
  base.line = pts.map((p, i) => `${X(i)},${Y(p.v)}`).join(' ');
  base.area = `${pad.l},${h - pad.b} ${base.line} ${X(pts.length - 1)},${h - pad.b}`;
  base.dots = pts.map((p, i) => ({ i, x: X(i), y: Y(p.v) }));
  const lastP = pts[pts.length - 1];
  const lv = levelOfValue(trend.metric, th, lastP.v);
  base.last = {
    x: X(pts.length - 1),
    y: Y(lastP.v),
    color: lv ? (LEVEL_COLOR[lv] || '#ffffff') : OK_COLOR,
    label: `${lastP.v}${trend.metric.unit || ''}${lv ? '（' + lv + '）' : ''}`,
  };
  const mk = (i) => {
    const d = new Date(pts[i].at);
    const p2 = (n) => String(n).padStart(2, '0');
    return `${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}`;
  };
  const labels = [[0, 'start'], [Math.floor((pts.length - 1) / 2), 'middle'], [pts.length - 1, 'end']];
  for (const [i, anchor] of labels) base.xLabels.push({ x: X(i), anchor, label: mk(i) });
  return base;
});

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

function showToast(msg) {
  toastMsg.value = msg;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastMsg.value = ''; }, 3000);
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
    if (j && j.ok) Object.assign(overview, j);
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
      showToast(action === 'ack' ? '已确认' : '已关闭');
    } else showToast(j.message || '操作失败');
  } catch (e) {
    showToast('本地服务异常：' + e.message);
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
    showToast(r.ok && j.ok ? j.message || '已触发采集' : j.message || '触发失败');
  } catch (e) {
    showToast('本地服务异常：' + e.message);
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
    p2: r.thresholds && typeof r.thresholds.p2 === 'number' ? r.thresholds.p2 : '',
    p1: r.thresholds && typeof r.thresholds.p1 === 'number' ? r.thresholds.p1 : '',
    p0: r.thresholds && typeof r.thresholds.p0 === 'number' ? r.thresholds.p0 : '',
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
      showToast('规则已保存并生效');
      rulesDrawer.value = false;
      await loadRules();
      loadOverview();
    } else showToast(j.message || '保存失败');
  } catch (e) {
    showToast('本地服务异常：' + e.message);
  } finally {
    savingRules.value = false;
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

// ---------- 生命周期 ----------
onMounted(async () => {
  await loadOverview();
  await loadAlerts();
  await loadRules();
  const firstAlert = sortedShops.value.find((s) => s.alerts.maxLevel) || sortedShops.value[0];
  if (firstAlert) selectShop(firstAlert.shopId);
  connectSse();
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
        <div class="stat dim"><b>{{ overview.totals.recovered }}</b><span>已恢复</span></div>
      </div>
      <div class="controls">
        <label class="ctl" title="投屏/展示模式"><input type="checkbox" v-model="projectMode" />投影</label>
        <label class="ctl" title="P0 告警声音提醒"><input type="checkbox" v-model="soundOn" />声音</label>
        <label class="ctl" title="投影模式下每 20 秒轮换店铺"><input type="checkbox" v-model="rotateOn" />轮播</label>
        <button class="btn" @click="manualCollect" title="立即采集所选店铺（未选择时全部店铺）">立即采集</button>
        <button class="btn" @click="openRules">告警规则</button>
      </div>
      <div class="clock">
        <b>{{ fmtClock(now) }}</b>
        <small :class="{ on: sseOk }">{{ sseOk ? '实时推送' : '轮询中' }}</small>
      </div>
    </header>

    <div v-if="!overview.configured || !overview.shops.length" class="empty">
      <h2>{{ !overview.configured ? '尚未配置开放平台 App' : '当前没有已授权店铺' }}</h2>
      <p>请先到门户页「开放平台」Tab 完成 App 配置与店铺授权，本大屏会自动开始巡检采集。</p>
      <p class="dim2">授权后无需任何额外设置：订单履约每 10 分钟、商品库存每 30 分钟、账户健康每小时自动采集。</p>
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
            :class="['lv-' + (s.alerts.maxLevel || 'ok'), { selected: s.shopId === selectedShop }, { flashing: s.alerts.maxLevel === 'P0' }]"
            @click="selectShop(s.shopId)"
          >
            <div class="sc-head">
              <span class="dot" :style="{ background: LEVEL_COLOR[s.alerts.maxLevel] || OK_COLOR }"></span>
              <b class="sc-name">{{ shopName(s) }}</b>
              <span class="sc-badges">
                <i v-if="s.alerts.P0" class="b-P0">P0×{{ s.alerts.P0 }}</i>
                <i v-if="s.alerts.P1" class="b-P1">P1×{{ s.alerts.P1 }}</i>
                <i v-if="s.alerts.P2" class="b-P2">P2×{{ s.alerts.P2 }}</i>
                <i v-if="!s.alerts.maxLevel" class="b-ok">正常</i>
              </span>
            </div>
            <div class="sc-metrics">
              <span v-for="m in s.matrix.slice(0, 4)" :key="m.metric" :title="(overview.metrics[m.metric] || {}).title || m.metric">
                <i>{{ (overview.metrics[m.metric] || {}).title || m.metric }}</i>
                <em :style="{ color: m.level ? LEVEL_COLOR[m.level] : '#9aa3b5' }">{{ m.v === null ? '—' : m.v }}</em>
              </span>
            </div>
            <div class="sc-foot">
              <span v-for="(label, dom) in DOMAIN_LABEL" :key="dom" :class="{ bad: s.failCount[dom] }">
                {{ label }}{{ s.lastRun[dom] ? '✓' + fmtTime(s.lastRun[dom]) : s.failCount[dom] ? '✗' + s.failCount[dom] + '次' : '·' }}
              </span>
            </div>
          </div>
        </div>
      </aside>

      <!-- 中：趋势 + 矩阵 -->
      <section class="center">
        <div class="panel trend-panel">
          <div class="tp-head">
            <select v-model="selectedShop" @change="selectShop($event.target.value)">
              <option value="">全部店铺（仅矩阵对比）</option>
              <option v-for="s in sortedShops" :key="s.shopId" :value="s.shopId">{{ shopName(s) }}</option>
            </select>
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
          <svg v-else-if="trend.points.length" class="chart" :viewBox="chartView.viewBox" preserveAspectRatio="none">
            <g v-for="g in chartView.gridY" :key="'gy' + g.y">
              <line :x1="chartView.pad.l" :x2="chartView.w - chartView.pad.r" :y1="g.y" :y2="g.y" class="gridline" />
              <text :x="chartView.pad.l - 6" :y="g.y + 4" class="ylab" text-anchor="end">{{ g.label }}</text>
            </g>
            <g v-for="th in chartView.thresholdLines" :key="'th' + th.label">
              <line :x1="chartView.pad.l" :x2="chartView.w - chartView.pad.r" :y1="th.y" :y2="th.y" class="thline" :style="{ stroke: th.color }" stroke-dasharray="5 4" />
              <text :x="chartView.w - chartView.pad.r - 4" :y="th.y - 4" class="thlab" :style="{ fill: th.color }" text-anchor="end">{{ th.label }}</text>
            </g>
            <polygon :points="chartView.area" class="area" />
            <polyline :points="chartView.line" class="pline" />
            <circle v-for="p in chartView.dots" :key="'d' + p.i" :cx="p.x" :cy="p.y" r="2.2" class="dot" />
            <circle v-if="chartView.last" :cx="chartView.last.x" :cy="chartView.last.y" r="4.5" class="lastdot" :style="{ fill: chartView.last.color, stroke: chartView.last.color }" />
            <text v-if="chartView.last" :x="Math.min(chartView.w - chartView.pad.r - 30, chartView.last.x + 8)" :y="chartView.last.y - 8" class="lastlab">{{ chartView.last.label }}</text>
            <text v-for="t in chartView.xLabels" :key="'x' + t.x" :x="t.x" :y="chartView.h - 8" class="xlab" :text-anchor="t.anchor">{{ t.label }}</text>
          </svg>
          <div v-else class="chart-empty">暂无「{{ trend.metric.title }}」采样数据，等待采集（订单 10 分钟 / 商品 30 分钟 / 健康 60 分钟）</div>
        </div>

        <div class="panel matrix-panel">
          <h3>多店指标对比矩阵 <small>底色 = 该店该指标当前告警级别 · 点击单元格看趋势</small></h3>
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
                    :style="{ background: m.level ? LEVEL_COLOR[m.level] + '33' : 'rgba(255,255,255,0.03)', color: m.level ? LEVEL_COLOR[m.level] : '#9aa3b5' }"
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
        <h3>实时告警流
          <small class="lvdot"><i style="background:#FF3B30"></i>P0 <i style="background:#FF9500"></i>P1 <i style="background:#FFD60A"></i>P2</small>
        </h3>
        <div class="filter">
          <button :class="{ active: filterLevel === '' }" @click="filterLevel = ''">全部({{ alerts.filter((a) => a.status !== 'recovered').length }})</button>
          <button :class="{ active: filterLevel === 'P0' }" @click="filterLevel = 'P0'">P0</button>
          <button :class="{ active: filterLevel === 'P1' }" @click="filterLevel = 'P1'">P1</button>
          <button :class="{ active: filterLevel === 'P2' }" @click="filterLevel = 'P2'">P2</button>
          <button :class="{ active: filterLevel === 'recovered' }" @click="filterLevel = 'recovered'">已恢复</button>
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
                <button v-if="a.status === 'open'" @click="alertAction(a, 'ack')">确认</button>
                <button @click="alertAction(a, 'close')">关闭</button>
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
          {{ overview.scheduler.running ? '巡检运行中' : '巡检已停止' }}
          <i v-if="overview.scheduler.active">·{{ overview.scheduler.active }} 项采集中</i>
        </span>
        <span
          v-for="s in sortedShops"
          :key="'cs' + s.shopId"
          class="cs-item"
          :class="{ bad: s.consecutiveFails > 0 }"
          :title="s.lastError ? JSON.stringify(s.lastError) : ''"
        >
          {{ shopName(s) }}
          <i v-for="(label, dom) in DOMAIN_LABEL" :key="dom" :class="{ fail: s.failCount[dom] }">
            {{ label }}{{ s.lastRun[dom] ? '✓' + fmtTime(s.lastRun[dom]) : s.failCount[dom] ? '✗' : '·' }}
          </i>
        </span>
      </div>
    </footer>

    <!-- ===== 规则编辑抽屉 ===== -->
    <div v-if="rulesDrawer" class="drawer-mask" @click.self="rulesDrawer = false">
      <div class="drawer">
        <h3>告警规则（阈值修改后立即生效）</h3>
        <p class="dim2">值越大越严重（店铺评分为「越小越严重」）。留空的级别不触发。</p>
        <div class="rule-table">
          <div class="rt-row rt-head">
            <span>启用</span><span>规则</span><span>P2 提醒</span><span>P1 重要</span><span>P0 紧急</span>
          </div>
          <div v-for="e in ruleEdits" :key="e.id" class="rt-row">
            <input type="checkbox" v-model="e.enabled" />
            <span class="rt-title">{{ e.title }}<i v-if="e.unit" class="dim2">（{{ e.unit }}）</i></span>
            <input type="number" v-model="e.p2" class="num" :class="{ p2c: e.p2 !== '' }" />
            <input type="number" v-model="e.p1" class="num" :class="{ p1c: e.p1 !== '' }" />
            <input type="number" v-model="e.p0" class="num" :class="{ p0c: e.p0 !== '' }" />
          </div>
        </div>
        <div class="drawer-ops">
          <button class="btn" @click="rulesDrawer = false">取消</button>
          <button class="btn primary" :disabled="savingRules" @click="saveRules">保存</button>
        </div>
      </div>
    </div>

    <!-- ===== 轻提示 ===== -->
    <div v-if="toastMsg" class="toast">{{ toastMsg }}</div>
  </div>
</template>

<style scoped>
* { box-sizing: border-box; margin: 0; padding: 0; }
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
.stat.p0.pulse { animation: cardPulse 1.6s ease-in-out infinite; }
@keyframes cardPulse {
  0%, 100% { box-shadow: 0 0 0 0 rgba(255, 59, 48, 0.5); }
  50% { box-shadow: 0 0 16px 3px rgba(255, 59, 48, 0.55); }
}
.controls { display: flex; gap: 10px; align-items: center; }
.ctl { font-size: 12px; color: #aab2c8; display: flex; gap: 4px; align-items: center; cursor: pointer; }
.ctl input { accent-color: #ee4d2d; }
.btn {
  background: #1d2340; color: #dfe3f2; border: 1px solid #2c3560;
  padding: 6px 12px; border-radius: 7px; font-size: 12px; cursor: pointer;
  font-family: inherit;
}
.btn:hover { background: #262e55; }
.btn.primary { background: #ee4d2d; border-color: #ee4d2d; color: #fff; }
.btn:disabled { opacity: 0.5; cursor: not-allowed; }
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
  grid-template-columns: 300px 1fr 360px;
  gap: 10px; padding: 10px;
}
.panel {
  background: #111527; border: 1px solid #1e2440; border-radius: 10px;
  display: flex; flex-direction: column; min-height: 0; overflow: hidden;
}
.panel > h3 {
  font-size: 13px; padding: 10px 12px 8px; color: #dfe3f2;
  border-bottom: 1px solid #1e2440; flex: none;
}
.panel > h3 small { color: #7d86a0; font-weight: 400; font-size: 11px; margin-left: 6px; }
/* 店铺墙 */
.shop-list { overflow-y: auto; padding: 8px; display: flex; flex-direction: column; gap: 8px; }
.shop-card {
  background: #171b2e; border: 1px solid #232a4a; border-left-width: 3px;
  border-radius: 8px; padding: 8px 10px; cursor: pointer; transition: all 0.15s;
}
.shop-card:hover { background: #1c2140; }
.shop-card.selected { outline: 1px solid #4a5bd8; }
.shop-card.lv-P0 { border-left-color: #FF3B30; background: rgba(255, 59, 48, 0.07); }
.shop-card.lv-P1 { border-left-color: #FF9500; }
.shop-card.lv-P2 { border-left-color: #FFD60A; }
.shop-card.lv-ok { border-left-color: #30D158; }
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
.sc-metrics { display: flex; gap: 8px; margin-top: 6px; flex-wrap: wrap; }
.sc-metrics span { display: flex; flex-direction: column; font-size: 10px; color: #7d86a0; }
.sc-metrics em { font-style: normal; font-size: 13px; font-weight: 600; }
.sc-foot { display: flex; gap: 10px; margin-top: 6px; font-size: 10px; color: #6d7690; }
.sc-foot span.bad, .sc-foot .fail { color: #FF3B30; }
/* 中间列 */
.center { display: flex; flex-direction: column; gap: 10px; min-height: 0; }
.trend-panel { flex: 1.2; }
.tp-head { display: flex; gap: 8px; align-items: center; padding: 8px 12px; flex: none; }
.tp-head select {
  background: #1d2340; color: #e6e9f2; border: 1px solid #2c3560;
  border-radius: 6px; padding: 5px 8px; font-size: 12px; max-width: 180px; font-family: inherit;
}
.chips { display: flex; gap: 6px; overflow-x: auto; flex: 1; }
.chips button {
  background: #171b2e; color: #aab2c8; border: 1px solid #232a4a; border-radius: 6px;
  padding: 4px 10px; font-size: 11px; white-space: nowrap; cursor: pointer; font-family: inherit;
}
.chips button.active { background: #2b3560; color: #fff; border-color: #4a5bd8; }
.chart { flex: 1; min-height: 0; width: 100%; padding: 4px 8px 8px; }
.gridline { stroke: #1e2440; stroke-width: 1; }
.ylab, .xlab { fill: #6d7690; font-size: 9px; }
.thline { stroke-width: 1.2; }
.thlab { font-size: 9px; }
.area { fill: rgba(74, 91, 216, 0.12); }
.pline { fill: none; stroke: #5a6ce0; stroke-width: 2; }
.dot { fill: #5a6ce0; }
.lastdot { stroke-width: 1.5; }
.lastlab { fill: #dfe3f2; font-size: 10px; font-weight: 600; }
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
/* 告警流 */
.alerts { min-width: 0; }
.filter { display: flex; gap: 6px; padding: 8px 10px; flex: none; }
.filter button {
  background: #171b2e; color: #aab2c8; border: 1px solid #232a4a; border-radius: 6px;
  padding: 3px 9px; font-size: 11px; cursor: pointer; font-family: inherit;
}
.filter button.active { background: #2b3560; color: #fff; border-color: #4a5bd8; }
.alert-list { overflow-y: auto; padding: 0 10px 10px; display: flex; flex-direction: column; gap: 8px; }
.alert-empty { color: #30D158; text-align: center; padding: 30px 0; font-size: 13px; }
.alert-item {
  display: flex; background: #171b2e; border: 1px solid #232a4a; border-radius: 8px;
  overflow: hidden; transition: opacity 0.2s;
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
.ai-head b { font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ai-shop { font-size: 10px; color: #7d86a0; background: #1d2340; padding: 1px 6px; border-radius: 4px; }
.ai-time { margin-left: auto; font-size: 10px; color: #6d7690; }
.ai-msg { font-size: 11px; color: #aab2c8; margin-top: 4px; line-height: 1.5; }
.ai-count { font-style: normal; color: #FF9500; margin-left: 4px; font-weight: 700; }
.ai-recovered { font-style: normal; color: #30D158; margin-left: 6px; }
.ai-ack { font-style: normal; color: #8a93ad; margin-left: 6px; }
.ai-ops { margin-top: 6px; display: flex; gap: 6px; }
.ai-ops button {
  background: #1d2340; color: #dfe3f2; border: 1px solid #2c3560; border-radius: 5px;
  padding: 2px 10px; font-size: 11px; cursor: pointer; font-family: inherit;
}
.ai-ops button:hover { background: #262e55; }
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
.coll-strip { display: flex; gap: 8px; overflow-x: auto; max-width: 45%; }
.cs-item {
  font-size: 10px; color: #7d86a0; background: #171b2e; border: 1px solid #232a4a;
  border-radius: 6px; padding: 3px 8px; white-space: nowrap;
}
.cs-item i { font-style: normal; margin-left: 4px; }
.cs-item i.fail { color: #FF3B30; }
.cs-item.bad { border-color: #FF3B30; color: #FF3B30; }
/* 抽屉 */
.drawer-mask {
  position: fixed; inset: 0; background: rgba(4, 6, 12, 0.7);
  display: flex; align-items: stretch; justify-content: flex-end; z-index: 50;
}
.drawer {
  width: 560px; max-width: 92vw; background: #131730; border-left: 1px solid #2c3560;
  padding: 18px; display: flex; flex-direction: column; gap: 10px; overflow-y: auto;
}
.drawer h3 { font-size: 15px; }
.rule-table { display: flex; flex-direction: column; gap: 6px; }
.rt-row {
  display: grid; grid-template-columns: 44px 1fr 88px 88px 88px;
  gap: 8px; align-items: center; background: #171b2e; border-radius: 7px; padding: 6px 10px;
}
.rt-row.rt-head { background: transparent; color: #7d86a0; font-size: 11px; }
.rt-head span { padding: 0 2px; }
.rt-title { font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rt-row input[type="checkbox"] { accent-color: #ee4d2d; width: 15px; height: 15px; }
.rt-row .num {
  background: #1d2340; color: #dfe3f2; border: 1px solid #2c3560; border-radius: 5px;
  padding: 4px 6px; width: 100%; font-size: 12px; font-family: inherit;
}
.num.p2c { border-color: #FFD60A; } .num.p1c { border-color: #FF9500; } .num.p0c { border-color: #FF3B30; }
.drawer-ops { display: flex; gap: 10px; justify-content: flex-end; margin-top: 6px; }
/* 轻提示 */
.toast {
  position: fixed; bottom: 54px; left: 50%; transform: translateX(-50%);
  background: #1d2340; color: #dfe3f2; border: 1px solid #4a5bd8; border-radius: 8px;
  padding: 9px 18px; font-size: 13px; z-index: 60; box-shadow: 0 6px 20px rgba(0, 0, 0, 0.4);
}
/* 投影模式：字号放大 */
.proj { font-size: 15px; }
.proj .shop-card { padding: 10px 12px; }
.proj .sc-name { font-size: 15px; }
.proj .matrix { font-size: 14px; }
.proj .ai-head b { font-size: 14px; }
.proj .ai-msg { font-size: 13px; }
</style>
