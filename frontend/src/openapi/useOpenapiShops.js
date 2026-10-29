// 开放平台页 · 逐店管理：测试 / 刷新 / 删除授权、busy 集合，以及展示格式化（stateMeta/fmtTime/envLabel）。
// 从 openapi/App.vue 抽出；操作完成后统一 refreshStatus 拉取最新状态。
import { reactive } from 'vue';
import { ElMessage } from 'element-plus';
import { postJsonResult } from '../composables/api.js';
import { shopStateMeta } from '../composables/shopState.js';
import { confirmDanger } from '../composables/confirmDanger.js';

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
      const { ok, data: j } = await postJsonResult('/api/openapi/test', { shopId });
      if (ok) ElMessage.success(j.message || '登录有效');
      else ElMessage.error(j.message || '测试失败');
    });
  }

  async function refreshShop(shopId) {
    await withShop(shopId, async () => {
      const { ok, data: j } = await postJsonResult('/api/openapi/refresh', { shopId });
      if (ok) ElMessage.success(j.message || '刷新成功');
      else ElMessage.error(j.message || '刷新失败');
    });
  }

  async function toggleImportant(shopId, important) {
    await withShop(shopId, async () => {
      const { ok, data: j } = await postJsonResult('/api/openapi/shop-important', { shopId, important });
      if (ok) ElMessage.success(j.message || '已更新重点店铺');
      else ElMessage.error(j.message || '更新重点店铺失败');
    });
  }

  async function removeShop(shopId) {
    const confirmed = await confirmDanger({
      message: `确定删除店铺 ${shopId} 的授权吗？删除后相关功能将无法调用官方接口。`,
      title: '删除授权',
      confirmText: '删除',
    });
    if (!confirmed) return; // 用户取消
    await withShop(shopId, async () => {
      const { ok, data: j } = await postJsonResult('/api/openapi/remove-shop', { shopId });
      if (ok) ElMessage.success(j.message || '已删除');
      else ElMessage.error(j.message || '删除失败');
    });
  }

  function fmtTime(t) {
    return t ? new Date(t * 1000).toLocaleString('zh-CN', { hour12: false }) : '—';
  }

  const envLabel = (e) => (e === 'sandbox' ? '沙箱' : '生产');

  return { busyShop, testShop, refreshShop, removeShop, toggleImportant, stateMeta: shopStateMeta, fmtTime, envLabel };
}
