// 监控大屏实时推送：订阅 /api/monitor/events SSE，把事件分流为告警更新/刷新/提醒。
import { onUnmounted } from 'vue';

export function useMonitorSse({ state, data, notify }) {
  let es = null;

  function onSseEvent(ev) {
    if (!ev || typeof ev !== 'object') return;
    if (ev.type === 'alert') {
      data.upsertAlert(ev.data);
      if (ev.data && ev.data.change === 'new' && ev.data.level === 'P0' && ev.data.status === 'open') {
        notify.flash(ev.data.id);
        notify.beep(2);
      } else if (ev.data && (ev.data.change === 'new' || ev.data.change === 'escalate')) {
        notify.flash(ev.data.id);
        if (ev.data.change === 'escalate') notify.beep(1);
      }
      data.refreshSoon();
    } else if (ev.type === 'collection') {
      data.refreshSoon();
    } else if (ev.type === 'rules') {
      data.loadRules();
      data.refreshSoon();
    } else if (ev.type === 'config') {
      // 其他页面修改了监控店铺配置或金额单位：同步刷新总览/告警/趋势
      data.loadOverview();
      data.loadAlerts();
      data.loadTrend(state.selectedShop.value, state.selectedMetric.value);
    }
  }

  function connect() {
    if (es) { try { es.close(); } catch { /* 忽略 */ } }
    es = new EventSource('/api/monitor/events');
    es.onopen = () => { state.sseOk.value = true; };
    es.onerror = () => { state.sseOk.value = false; };
    es.onmessage = (m) => {
      try { onSseEvent(JSON.parse(m.data)); } catch { /* 忽略无法解析的事件 */ }
    };
  }

  onUnmounted(() => {
    if (es) { try { es.close(); } catch { /* 忽略 */ } }
  });

  return { connect };
}
