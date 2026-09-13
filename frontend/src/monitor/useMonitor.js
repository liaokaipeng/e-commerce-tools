// 监控大屏数据层编排：组合状态、数据访问、实时推送、在场心跳与各面板，向外暴露页面所需 API。
// 页面组件（App.vue）只做视图编排，本文件不关心任何 DOM 结构，便于单独演进。
// 分工：状态与派生 useMonitorState / 数据访问 useMonitorData / 实时推送 useMonitorSse /
//       在场心跳 useMonitorPresence / 提醒 useMonitorNotify / 规则 useMonitorRules / 店铺 useMonitorShops。
import { watch, onMounted, onUnmounted } from 'vue';
import { useMonitorState } from './useMonitorState.js';
import { useMonitorData } from './useMonitorData.js';
import { useMonitorNotify } from './useMonitorNotify.js';
import { useMonitorPresence } from './useMonitorPresence.js';
import { useMonitorSse } from './useMonitorSse.js';
import { useMonitorRules } from './useMonitorRules.js';
import { useMonitorShops } from './useMonitorShops.js';
import { showToast } from './toast.js';

/** SSE 断开时兜底轮询间隔 */
const POLL_FALLBACK_MS = 30 * 1000;
/** 投影模式轮播间隔 */
const ROTATE_INTERVAL_MS = 20 * 1000;

export function useMonitor() {
  const state = useMonitorState();
  const data = useMonitorData(state);
  const notify = useMonitorNotify(state);
  const sse = useMonitorSse({ state, data, notify });
  const rules = useMonitorRules({ state, data });
  const shops = useMonitorShops({ state, data });
  useMonitorPresence(data.postJson);

  let rotateTimer = null;

  /** 跳转到门户页「开放平台」Tab（同源 iframe，经 parent postMessage 切 Tab） */
  function goOpenapi() {
    try { window.parent.postMessage({ type: 'switch-tab', key: 'openapi' }, location.origin || '*'); } catch { /* 忽略 */ }
    showToast('请到「开放平台」Tab 用主账号重新授权一次，全部店铺即恢复');
  }

  /** 打开告警详情抽屉（查看该告警的具体明细清单，如断货商品 ID / 待发货订单号） */
  function openAlertDetail(a) {
    if (!a) return;
    state.detailAlert.value = a;
    state.detailDrawer.value = true;
  }

  // ---------- 投影轮播 ----------
  function rotate() {
    const pool = state.sortedShops.value;
    if (!pool.length) return;
    const withAlerts = pool.filter((s) => s.alerts.maxLevel);
    const list = withAlerts.length ? withAlerts : pool;
    const idx = list.findIndex((s) => s.shopId === state.selectedShop.value);
    data.selectShop(list[(idx + 1) % list.length].shopId);
  }

  function applyRotate() {
    clearInterval(rotateTimer);
    if (state.projectMode.value && state.rotateOn.value) rotateTimer = setInterval(rotate, ROTATE_INTERVAL_MS);
  }

  watch([state.projectMode, state.rotateOn], applyRotate);

  // ---------- 生命周期 ----------
  onMounted(async () => {
    // Element Plus 深色主题（本页为 iframe 内独立 document，弹层/控件跟随暗色变量）
    document.documentElement.classList.add('dark');
    await data.loadOverview();
    await data.loadAlerts();
    await data.loadRules();
    state.initialLoading.value = false;
    const firstAlert = state.sortedShops.value.find((s) => s.alerts.maxLevel) || state.sortedShops.value[0];
    if (firstAlert) data.selectShop(firstAlert.shopId);
    sse.connect();
    // 兜底轮询（SSE 断开时数据不落后太多）+ 时钟
    setInterval(() => {
      if (!state.sseOk.value) { data.loadOverview(); data.loadAlerts(); }
    }, POLL_FALLBACK_MS);
    setInterval(() => { state.now.value = Date.now(); }, 1000);
    applyRotate();
  });

  onUnmounted(() => {
    clearInterval(rotateTimer);
    document.documentElement.classList.remove('dark');
  });

  return {
    // 状态
    overview: state.overview, rules: state.rules, trend: state.trend, now: state.now,
    selectedShop: state.selectedShop, selectedMetric: state.selectedMetric, filterLevel: state.filterLevel,
    projectMode: state.projectMode, soundOn: state.soundOn, rotateOn: state.rotateOn,
    sseOk: state.sseOk, flashIds: state.flashIds, initialLoading: state.initialLoading,
    trendDays: state.trendDays, trendCompare: state.trendCompare,
    rulesDrawer: state.rulesDrawer, ruleEdits: state.ruleEdits, savingRules: state.savingRules,
    ruleSuggestions: state.ruleSuggestions, loadingSuggestions: state.loadingSuggestions,
    shopsDrawer: state.shopsDrawer, shopConfig: state.shopConfig, savingShops: state.savingShops, shopSearch: state.shopSearch,
    detailDrawer: state.detailDrawer, detailAlert: state.detailAlert,
    // 派生
    alerts: state.shownAlerts, sortedShops: state.sortedShops, normalCount: state.normalCount, reAuthCount: state.reAuthCount,
    openTopAlerts: state.openTopAlerts, openCount: state.openCount, tickerText: state.tickerText, metricChips: state.metricChips,
    topAlertByShop: state.topAlertByShop, selectedShopObj: state.selectedShopObj, selectedFail: state.selectedFail,
    shownShopConfig: state.shownShopConfig, monitoredCount: state.monitoredCount,
    // 动作
    selectShop: data.selectShop, selectMetric: data.selectMetric,
    setTrendDays: data.setTrendDays, toggleTrendCompare: data.toggleTrendCompare,
    openRules: rules.openRules, saveRules: rules.saveRules, applySuggestion: rules.applySuggestion,
    openShopsConfig: shops.openShopsConfig, setAllMonitored: shops.setAllMonitored, saveShopsConfig: shops.saveShopsConfig,
    saveCurrencyMode: data.saveCurrencyMode, manualCollect: data.manualCollect,
    alertAction: data.alertAction, batchAlertAction: data.batchAlertAction,
    goOpenapi, openAlertDetail,
  };
}
