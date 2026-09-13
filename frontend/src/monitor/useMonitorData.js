// 监控大屏数据访问层：HTTP 请求、加载器、趋势选择、告警操作与配置类动作。
import { showToast } from './toast.js';
import { levelRank } from './constants.js';

/** 收到 SSE 后合并刷新的防抖延时（避免一轮采集触发多次拉取） */
const REFRESH_DEBOUNCE_MS = 800;

export function useMonitorData(state) {
  let refreshTimer = null;

  // ---------- 传输 ----------
  /** POST JSON，返回 { ok, data }：ok = HTTP 2xx 且业务 ok；网络/解析异常抛出，由调用方统一提示 */
  async function postJson(url, body) {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
    });
    const data = await r.json();
    return { ok: r.ok && !!data && data.ok === true, data: data || {} };
  }

  // ---------- 加载器 ----------
  async function loadOverview() {
    try {
      const r = await fetch('/api/monitor/overview');
      const j = await r.json();
      if (j && j.ok) {
        Object.assign(state.overview, j);
        // 所选店铺可能已被停用监控：不在列表中则改选第一家
        if (state.selectedShop.value && !state.overview.shops.some((s) => s.shopId === state.selectedShop.value)) {
          const first = state.overview.shops.find((s) => s.alerts.maxLevel) || state.overview.shops[0];
          selectShop(first ? first.shopId : '');
        }
      }
    } catch { /* 服务未就绪，兜底轮询重试 */ }
  }

  async function loadAlerts() {
    try {
      const r = await fetch('/api/monitor/alerts');
      const j = await r.json();
      if (j && j.ok) state.alerts.value = j.alerts || [];
    } catch { /* 同上 */ }
  }

  async function loadRules() {
    try {
      const r = await fetch('/api/monitor/rules');
      const j = await r.json();
      if (j && j.ok) state.rules.value = j.rules || [];
    } catch { /* 忽略 */ }
  }

  async function loadTrend(shopId, metric) {
    state.trend.points = [];
    state.trend.prev = [];
    if (!shopId || !metric) return;
    try {
      const q = `days=${state.trendDays.value}${state.trendCompare.value ? '&compare=1' : ''}`;
      const r = await fetch(`/api/monitor/trend?shopId=${encodeURIComponent(shopId)}&metric=${encodeURIComponent(metric)}&${q}`);
      const j = await r.json();
      if (j && j.ok) {
        state.trend.metric = j.metric || state.trend.metric;
        state.trend.thresholds = j.thresholds;
        state.trend.points = j.points || [];
        state.trend.prev = j.prevPoints || [];
      }
    } catch { /* 忽略 */ }
  }

  function refreshSoon() {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => { loadOverview(); loadAlerts(); }, REFRESH_DEBOUNCE_MS);
  }

  function upsertAlert(a) {
    if (!a) return;
    const i = state.alerts.value.findIndex((x) => x.id === a.id);
    // 删除（change=delete）与历史遗留的「已关闭」都从列表移除
    if (a.change === 'delete' || a.status === 'closed') {
      if (i >= 0) state.alerts.value.splice(i, 1);
      return;
    }
    if (i >= 0) state.alerts.value.splice(i, 1, a);
    else state.alerts.value.unshift(a);
    state.alerts.value.sort((x, y) => levelRank(y.level) - levelRank(x.level) || y.updatedAt - x.updatedAt);
  }

  // ---------- 趋势选择 ----------
  function selectShop(shopId) {
    state.selectedShop.value = shopId || '';
    loadTrend(state.selectedShop.value, state.selectedMetric.value);
  }

  function selectMetric(metric) {
    state.selectedMetric.value = metric;
    loadTrend(state.selectedShop.value, metric);
  }

  /** 切换趋势时间窗（1/7/30 天）并重新拉取 */
  function setTrendDays(d) {
    state.trendDays.value = d;
    loadTrend(state.selectedShop.value, state.selectedMetric.value);
  }

  /** 切换环比对比线开关并重新拉取 */
  function toggleTrendCompare(v) {
    state.trendCompare.value = v;
    loadTrend(state.selectedShop.value, state.selectedMetric.value);
  }

  // ---------- 告警操作 ----------
  async function alertAction(a, action) {
    try {
      const { ok, data } = await postJson('/api/monitor/alert-action', { id: a.id, action });
      if (ok) {
        upsertAlert(data.alert); // 响应里的告警带 change:'delete'，upsertAlert 会从列表移除
        showToast(action === 'delete' ? '已删除该告警' : '操作已完成', 'success');
        refreshSoon(); // 总览计数（P0/P1/P2 徽标、店铺墙）同步刷新，SSE 断开时也能及时更新
      } else showToast(data.message || '操作失败', 'error');
    } catch (e) {
      showToast('本地服务异常：' + e.message, 'error');
    }
  }

  /** 批量删除（告警流多选操作；后端支持 { ids } 形态） */
  async function batchAlertAction(ids, action) {
    const list = (ids || []).filter(Boolean);
    if (!list.length) return;
    try {
      const { ok, data } = await postJson('/api/monitor/alert-action', { ids: list, action });
      if (ok) {
        // 响应里的每条告警都带 change:'delete'，upsertAlert 逐条从列表移除
        for (const a of (data.alerts || [data.alert])) if (a) upsertAlert(a);
        showToast(`已删除 ${data.count || list.length} 条告警`, 'success');
        refreshSoon(); // 总览计数同步刷新（SSE 断开时也能及时更新）
      } else showToast(data.message || '操作失败', 'error');
    } catch (e) {
      showToast('本地服务异常：' + e.message, 'error');
    }
  }

  async function manualCollect() {
    try {
      const { ok, data } = await postJson('/api/monitor/collect', {});
      showToast(data.message || (ok ? '已触发采集' : '触发失败'), ok ? 'success' : 'error');
    } catch (e) {
      showToast('本地服务异常：' + e.message, 'error');
    }
  }

  /** 切换金额展示单位（规则阈值始终按人民币配置与比较，仅影响展示与告警消息） */
  async function saveCurrencyMode() {
    try {
      const { ok, data } = await postJson('/api/monitor/currency-config', { mode: state.overview.currencyMode });
      if (ok) {
        showToast(data.message || '已切换金额单位', 'success');
        await loadOverview();
        await loadAlerts();
        loadTrend(state.selectedShop.value, state.selectedMetric.value);
      } else {
        showToast(data.message || '切换失败', 'error');
        await loadOverview(); // 还原服务端生效值
      }
    } catch (e) {
      showToast('本地服务异常：' + e.message, 'error');
    }
  }

  return {
    postJson,
    loadOverview, loadAlerts, loadRules, loadTrend, refreshSoon, upsertAlert,
    selectShop, selectMetric, setTrendDays, toggleTrendCompare,
    alertAction, batchAlertAction, manualCollect, saveCurrencyMode,
  };
}
