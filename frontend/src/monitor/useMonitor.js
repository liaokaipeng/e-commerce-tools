// 监控大屏的数据层：状态、接口调用、SSE 推送、在场心跳、投影轮播与生命周期。
// 页面组件（App.vue）只做视图编排，本文件不关心任何 DOM 结构，便于单独演进。
import { ref, reactive, computed, watch, onMounted, onUnmounted } from 'vue';
import { ElMessage } from 'element-plus';
import { MATRIX_METRICS, levelRank, shopName, failInfo } from './constants.js';

/** 在场心跳间隔：30s 上报一次「大屏仍可见」，服务端据此按需采集 */
const PRESENCE_HEARTBEAT_MS = 30 * 1000;
/** SSE 断开时兜底轮询间隔 */
const POLL_FALLBACK_MS = 30 * 1000;
/** 投影模式轮播间隔 */
const ROTATE_INTERVAL_MS = 20 * 1000;
/** 收到 SSE 后合并刷新的防抖延时（避免一轮采集触发多次拉取） */
const REFRESH_DEBOUNCE_MS = 800;

export function useMonitor() {
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
  // 告警详情抽屉：当前查看的告警快照（SSE 更新会替换 alerts 里的对象，抽屉内保持打开时的快照）
  const detailDrawer = ref(false);
  const detailAlert = ref(null);
  const now = ref(Date.now());

  let es = null;
  let refreshTimer = null;
  let rotateTimer = null;
  let audioCtx = null;
  let presenceTimer = null;
  let parentTimer = null;

  // ---------- 计算 ----------
  const sortedShops = computed(() => {
    const arr = overview.shops.slice();
    arr.sort((a, b) => levelRank(b.alerts.maxLevel) - levelRank(a.alerts.maxLevel) || shopName(a).localeCompare(shopName(b)));
    return arr;
  });

  const normalCount = computed(() => overview.shops.filter((s) => !s.alerts.maxLevel).length);

  const reAuthCount = computed(() => overview.reAuthCount || overview.shops.filter((s) => s.authBroken).length);

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

  /** 按关键词过滤监控店铺配置（店铺名 / 店铺ID，大小写不敏感，空格分隔多关键词需同时命中） */
  const shownShopConfig = computed(() => {
    const kws = shopSearch.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (!kws.length) return shopConfig.value;
    return shopConfig.value.filter((s) => {
      const hay = `${s.name || ''} ${s.shopId}`.toLowerCase();
      return kws.every((k) => hay.includes(k));
    });
  });

  const monitoredCount = computed(() => shopConfig.value.filter((s) => s.monitored).length);

  // ---------- 工具函数 ----------
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

  /** 跳转到门户页「开放平台」Tab（同源 iframe，经 parent postMessage 切 Tab） */
  function goOpenapi() {
    try { window.parent.postMessage({ type: 'switch-tab', key: 'openapi' }, location.origin || '*'); } catch { /* 忽略 */ }
    showToast('请到「开放平台」Tab 用主账号重新授权一次，全部店铺即恢复');
  }

  /** 打开告警详情抽屉（查看该告警的具体明细清单，如断货商品 ID / 待发货订单号） */
  function openAlertDetail(a) {
    if (!a) return;
    detailAlert.value = a;
    detailDrawer.value = true;
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
    refreshTimer = setTimeout(() => { loadOverview(); loadAlerts(); }, REFRESH_DEBOUNCE_MS);
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
        // 留空的级别统一送 null（= 显式禁用该级别）：不送 / 送 undefined 时后端会保留默认阈值，
        // 表现为「清空输入框保存后阈值又自己回来了」。
        for (const k of ['p2', 'p1', 'p0']) {
          const raw = e[k];
          const n = raw === '' || raw === null || raw === undefined ? NaN : Number(raw);
          th[k] = isFinite(n) ? n : null;
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
        loadTrend(selectedShop.value, selectedMetric.value); // 阈值参考线同步刷新（矩阵定级走 loadOverview）
      } else showToast(j.message || '保存失败', 'error');
    } catch (e) {
      showToast('本地服务异常：' + e.message, 'error');
    } finally {
      savingRules.value = false;
    }
  }

  // ---------- 监控店铺配置面板 ----------
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
    if (projectMode.value && rotateOn.value) rotateTimer = setInterval(rotate, ROTATE_INTERVAL_MS);
  }

  watch([projectMode, rotateOn], applyRotate);

  // ---------- 在场心跳（按需采集：仅本页可见时采集，离开即停） ----------
  let tabActive = window.parent === window; // 直接打开本页（非门户 iframe）时默认视为可见
  let hasParentReply = false;

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
    // 兜底轮询（SSE 断开时数据不落后太多）+ 时钟
    setInterval(() => {
      if (!sseOk.value) { loadOverview(); loadAlerts(); }
    }, POLL_FALLBACK_MS);
    setInterval(() => { now.value = Date.now(); }, 1000);
    applyRotate();
  });

  onUnmounted(() => {
    if (es) { try { es.close(); } catch { /* 忽略 */ } }
    clearInterval(rotateTimer);
    stopPresence();
    if (parentTimer) clearTimeout(parentTimer);
    window.removeEventListener('message', onParentMessage);
    document.removeEventListener('visibilitychange', onVisibilityChange);
    document.documentElement.classList.remove('dark');
  });

  return {
    // 状态
    overview, rules, trend, now,
    selectedShop, selectedMetric, filterLevel,
    projectMode, soundOn, rotateOn, sseOk, flashIds,
    rulesDrawer, ruleEdits, savingRules,
    shopsDrawer, shopConfig, savingShops, shopSearch,
    detailDrawer, detailAlert,
    // 派生
    alerts: shownAlerts, sortedShops, normalCount, reAuthCount,
    openTopAlerts, openCount, tickerText, metricChips,
    selectedShopObj, selectedFail, shownShopConfig, monitoredCount,
    // 动作
    selectShop, selectMetric, openRules, saveRules,
    openShopsConfig, setAllMonitored, saveShopsConfig,
    saveCurrencyMode, manualCollect, alertAction, goOpenapi, openAlertDetail,
  };
}
