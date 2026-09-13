// 监控店铺配置抽屉：读取授权店铺、勾选监控范围、保存排除名单。
import { showToast } from './toast.js';

export function useMonitorShops({ state, data }) {
  async function openShopsConfig() {
    try {
      const r = await fetch('/api/monitor/shops-config');
      const j = await r.json();
      if (j && j.ok) {
        state.shopConfig.value = (j.shops || []).map((s) => Object.assign({}, s));
        state.shopSearch.value = '';
        state.shopsDrawer.value = true;
      } else showToast(j.message || '读取失败', 'error');
    } catch (e) {
      showToast('本地服务异常：' + e.message, 'error');
    }
  }

  /** 勾选/取消当前列表（无搜索词时作用于全部店铺，有搜索词时只作用于匹配项） */
  function setAllMonitored(v) {
    for (const s of state.shownShopConfig.value) s.monitored = v;
  }

  async function saveShopsConfig() {
    state.savingShops.value = true;
    try {
      const excludedShopIds = state.shopConfig.value.filter((s) => !s.monitored).map((s) => s.shopId);
      const { ok, data: res } = await data.postJson('/api/monitor/shops-config', { excludedShopIds });
      if (ok) {
        showToast('监控店铺配置已保存', 'success');
        state.shopsDrawer.value = false;
        await data.loadOverview();
        await data.loadAlerts();
      } else showToast(res.message || '保存失败', 'error');
    } catch (e) {
      showToast('本地服务异常：' + e.message, 'error');
    } finally {
      state.savingShops.value = false;
    }
  }

  return { openShopsConfig, setAllMonitored, saveShopsConfig };
}
