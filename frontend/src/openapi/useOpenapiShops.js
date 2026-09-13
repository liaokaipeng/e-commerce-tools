// 开放平台页 · 逐店管理：测试 / 刷新 / 删除授权、busy 集合，以及展示格式化（stateMeta/fmtTime/envLabel）。
// 从 openapi/App.vue 抽出；操作完成后统一 refreshStatus 拉取最新状态。
import { reactive } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';

export function useOpenapiShops({ refreshStatus }) {
  const busyShop = reactive(new Set()); // 正在操作中的店铺

  // ---------- ③ 店铺管理 ----------
  async function withShop(shopId, fn) {
    if (busyShop.has(shopId)) return;
    busyShop.add(shopId);
    try {
      await fn();
    } finally {
      busyShop.delete(shopId);
      await refreshStatus();
    }
  }

  async function testShop(shopId) {
    await withShop(shopId, async () => {
      const r = await fetch('/api/openapi/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shopId }),
      });
      const j = await r.json();
      if (r.ok && j.ok) ElMessage.success(j.message || '登录有效');
      else ElMessage.error(j.message || '测试失败');
    });
  }

  async function refreshShop(shopId) {
    await withShop(shopId, async () => {
      const r = await fetch('/api/openapi/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shopId }),
      });
      const j = await r.json();
      if (r.ok && j.ok) ElMessage.success(j.message || '刷新成功');
      else ElMessage.error(j.message || '刷新失败');
    });
  }

  async function removeShop(shopId) {
    try {
      await ElMessageBox.confirm(`确定删除店铺 ${shopId} 的授权吗？删除后相关功能将无法调用官方接口。`, '删除授权', {
        confirmButtonText: '删除',
        cancelButtonText: '取消',
        type: 'warning',
      });
    } catch {
      return; // 用户取消
    }
    await withShop(shopId, async () => {
      const r = await fetch('/api/openapi/remove-shop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shopId }),
      });
      const j = await r.json();
      if (r.ok && j.ok) ElMessage.success(j.message || '已删除');
      else ElMessage.error(j.message || '删除失败');
    });
  }

  function stateMeta(s) {
    if (s.state === 'valid') return { type: 'success', label: '有效' };
    if (s.state === 'expiring') return { type: 'warning', label: '即将过期' };
    if (s.state === 're_auth') return { type: 'danger', label: '需重新授权' };
    return { type: 'danger', label: '已过期' };
  }

  function fmtTime(t) {
    return t ? new Date(t * 1000).toLocaleString('zh-CN', { hour12: false }) : '—';
  }

  const envLabel = (e) => (e === 'sandbox' ? '沙箱' : '生产');

  return { busyShop, testShop, refreshShop, removeShop, stateMeta, fmtTime, envLabel };
}
