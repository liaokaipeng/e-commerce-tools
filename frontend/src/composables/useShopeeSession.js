// Shopee 会话组合式函数：登录状态轮询 + 店铺列表与勾选集合。
// bidding / bidding-cancel / hotlisting-cancel 三页共用；组合登录状态（useSessionStatus）
// 与开放平台店铺列表（useOpenapiStores），本文件只维护勾选集合与生命周期。
// 注意：店铺的分组与勾选渲染由 StorePicker 组件承担，这里只维护 selected 集合本身。
import { reactive, computed, onMounted, onUnmounted } from 'vue';
import { useSessionStatus } from './useSessionStatus.js';
import { useOpenapiStores } from './useOpenapiStores.js';

export function useShopeeSession(readyTip = 'Cookie 已就绪，可直接选择店铺操作。') {
  const { status, refreshing, flash, refreshStatus } = useSessionStatus(readyTip);
  const { stores, storesLoading, storesEmptyTip, loadStores } = useOpenapiStores({ emptyTip: true, errorToast: true });

  const selected = reactive(new Set());
  const selCount = computed(() => selected.size);

  function clearAll() {
    selected.clear();
  }

  // ---------- 生命周期：挂载即查 + 15s 轮询登录状态 ----------
  let timer = null;
  onMounted(() => {
    refreshStatus();
    loadStores();
    timer = setInterval(() => refreshStatus(), 15000);
  });
  onUnmounted(() => {
    if (timer) clearInterval(timer);
  });

  return {
    status, refreshing, flash, refreshStatus,
    stores, storesLoading, storesEmptyTip, selected, selCount, clearAll, loadStores,
  };
}
