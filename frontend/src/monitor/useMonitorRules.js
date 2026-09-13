// 规则编辑抽屉：阈值编辑副本、历史建议拉取与保存。
import { showToast } from './toast.js';

export function useMonitorRules({ state, data }) {
  function openRules() {
    state.ruleEdits.value = state.rules.value.map((r) => ({
      id: r.id,
      title: r.title,
      unit: (state.overview.metrics[r.metric] || {}).unit || r.unit || '',
      enabled: r.enabled !== false,
      p2: r.thresholds && typeof r.thresholds.p2 === 'number' ? r.thresholds.p2 : null,
      p1: r.thresholds && typeof r.thresholds.p1 === 'number' ? r.thresholds.p1 : null,
      p0: r.thresholds && typeof r.thresholds.p0 === 'number' ? r.thresholds.p0 : null,
    }));
    state.rulesDrawer.value = true;
    loadRuleSuggestions();
  }

  /** 拉取阈值分位数建议（只读快照，不落盘、不自动应用） */
  async function loadRuleSuggestions() {
    state.loadingSuggestions.value = true;
    try {
      const r = await fetch('/api/monitor/rule-suggestions?days=30');
      const j = await r.json();
      if (j && j.ok) state.ruleSuggestions.value = j.suggest || {};
    } catch { /* 忽略：建议不可用不影响手动编辑 */ } finally {
      state.loadingSuggestions.value = false;
    }
  }

  /** 把某条规则的历史建议填入编辑行（仅填输入框，仍需用户点「保存」才生效） */
  function applySuggestion(id) {
    const s = state.ruleSuggestions.value[id];
    if (!s || !s.suggest) return;
    const row = state.ruleEdits.value.find((e) => e.id === id);
    if (!row) return;
    row.p2 = s.suggest.p2;
    row.p1 = s.suggest.p1;
    row.p0 = s.suggest.p0;
    showToast('已填入历史建议值，请确认后点「保存」生效', 'info');
  }

  async function saveRules() {
    state.savingRules.value = true;
    try {
      const overrides = {};
      for (const e of state.ruleEdits.value) {
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
      const { ok, data: res } = await data.postJson('/api/monitor/rules', { overrides });
      if (ok) {
        showToast('规则已保存并生效', 'success');
        state.rulesDrawer.value = false;
        await data.loadRules();
        data.loadOverview();
        data.loadTrend(state.selectedShop.value, state.selectedMetric.value); // 阈值参考线同步刷新（矩阵定级走 loadOverview）
      } else showToast(res.message || '保存失败', 'error');
    } catch (e) {
      showToast('本地服务异常：' + e.message, 'error');
    } finally {
      state.savingRules.value = false;
    }
  }

  return { openRules, loadRuleSuggestions, applySuggestion, saveRules };
}
