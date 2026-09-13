// 监控大屏的响应式状态与派生数据（无副作用：只声明状态与选择器，不发请求、不动 DOM）。
import { ref, reactive, computed } from 'vue';
import { MATRIX_METRICS, levelRank, shopName, failInfo, filterByKeywords } from './constants.js';

export function useMonitorState() {
  // ---------- 状态 ----------
  const overview = reactive({
    configured: false,
    scheduler: { running: false, active: 0, lastTickAt: 0 },
    totals: { P0: 0, P1: 0, P2: 0 },
    reAuthCount: 0,
    excludedCount: 0,
    currencyMode: 'local', // 金额展示单位：local=当地货币（默认）/ rmb=人民币；规则阈值始终按人民币
    metrics: {},
    shops: [],
    at: 0,
  });
  const alerts = ref([]);
  const rules = ref([]);
  const trend = reactive({ metric: { id: '', title: '', unit: '' }, thresholds: null, points: [], prev: [] });
  // 趋势时间窗（1/7/30 天）与环比对比线开关
  const trendDays = ref(7);
  const trendCompare = ref(true);
  const selectedShop = ref('');
  const selectedMetric = ref('order.pending_24h');
  const filterLevel = ref('');
  const projectMode = ref(false);
  const soundOn = ref(true);
  const rotateOn = ref(true);
  const sseOk = ref(false);
  const initialLoading = ref(true);
  const flashIds = reactive(new Set());
  const rulesDrawer = ref(false);
  const ruleEdits = ref([]);
  const ruleSuggestions = ref({});
  const loadingSuggestions = ref(false);
  const savingRules = ref(false);
  const shopsDrawer = ref(false);
  const shopConfig = ref([]);
  const savingShops = ref(false);
  const shopSearch = ref('');
  // 告警详情抽屉：当前查看的告警快照（SSE 更新会替换 alerts 里的对象，抽屉内保持打开时的快照）
  const detailDrawer = ref(false);
  const detailAlert = ref(null);
  const now = ref(Date.now());

  // ---------- 派生 ----------
  const sortedShops = computed(() => {
    const arr = overview.shops.slice();
    arr.sort((a, b) => levelRank(b.alerts.maxLevel) - levelRank(a.alerts.maxLevel) || shopName(a).localeCompare(shopName(b)));
    return arr;
  });

  const normalCount = computed(() => overview.shops.filter((s) => !s.alerts.maxLevel).length);

  const reAuthCount = computed(() => overview.reAuthCount || overview.shops.filter((s) => s.authBroken).length);

  const shownAlerts = computed(() => {
    let list = alerts.value;
    if (filterLevel.value) list = list.filter((a) => a.level === filterLevel.value);
    return list;
  });

  const openTopAlerts = computed(() => alerts.value.filter((a) => a.status === 'open' && (a.level === 'P0' || a.level === 'P1')));

  const openCount = computed(() => alerts.value.length);

  /** 每店最高优先级的未关闭告警（店铺墙「最高告警」摘要用） */
  const topAlertByShop = computed(() => {
    const m = {};
    for (const a of alerts.value) {
      if (a.status !== 'open' && a.status !== 'ack') continue;
      const cur = m[a.shopId];
      if (!cur || levelRank(a.level) > levelRank(cur.level)
        || (levelRank(a.level) === levelRank(cur.level) && a.updatedAt > cur.updatedAt)) {
        m[a.shopId] = a;
      }
    }
    return m;
  });

  const tickerText = computed(() => openTopAlerts.value
    .map((a) => `【${a.level}】${shopName(overview.shops.find((s) => s.shopId === a.shopId))} ${a.title}：${a.message}`)
    .join('　·　'));

  const metricChips = computed(() => MATRIX_METRICS.map((id) => Object.assign({ id }, overview.metrics[id] || { title: id, unit: '' })));

  const selectedShopObj = computed(() => overview.shops.find((s) => s.shopId === selectedShop.value) || null);

  /** 当前所选店铺+指标的采集失败信息（趋势面板警示用） */
  const selectedFail = computed(() => (selectedShopObj.value && selectedMetric.value
    ? failInfo(selectedShopObj.value, selectedMetric.value) : null));

  /** 按关键词过滤监控店铺配置（店铺名 / 店铺ID，大小写不敏感，空格分隔多关键词需同时命中） */
  const shownShopConfig = computed(() => filterByKeywords(shopConfig.value, shopSearch.value, (s) => `${s.name || ''} ${s.shopId}`));

  const monitoredCount = computed(() => shopConfig.value.filter((s) => s.monitored).length);

  return {
    overview, alerts, rules, trend, trendDays, trendCompare, selectedShop, selectedMetric,
    filterLevel, projectMode, soundOn, rotateOn, sseOk, initialLoading, flashIds,
    rulesDrawer, ruleEdits, ruleSuggestions, loadingSuggestions, savingRules,
    shopsDrawer, shopConfig, savingShops, shopSearch, detailDrawer, detailAlert, now,
    sortedShops, normalCount, reAuthCount, shownAlerts, openTopAlerts, openCount,
    topAlertByShop, tickerText, metricChips, selectedShopObj, selectedFail,
    shownShopConfig, monitoredCount,
  };
}
