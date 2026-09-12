// Shopee 会话组合式函数：登录状态轮询 + 店铺列表与勾选集合。
// bidding / bidding-cancel / hotlisting-cancel 三页共用。
// 注意：店铺的分组与勾选渲染由 StorePicker 组件承担，这里只维护 selected 集合本身。
import { ref, reactive, computed, onMounted, onUnmounted } from 'vue';
import { ElMessage } from 'element-plus';
import { resolveOpenapiEmptyTip } from './openapiEmptyTip.js';

export function useShopeeSession(readyTip = 'Cookie 已就绪，可直接选择店铺操作。') {
  // ---------- 登录状态 ----------
  const status = reactive({ loggedIn: false, cookieCount: 0, savedAt: '', tip: '', checking: true });
  const refreshing = ref(false);
  const flash = ref(false);

  async function refreshStatus(manual = false) {
    if (refreshing.value) return;
    refreshing.value = true;
    status.checking = true;
    try {
      const r = await fetch('/api/status');
      const s = await r.json();
      if (s.loggedIn) {
        status.loggedIn = true;
        status.cookieCount = s.cookieCount;
        const saved = s.savedAt ? `最近推送时间：${new Date(s.savedAt).toLocaleString()}。` : '';
        status.tip = `${readyTip}${saved}如登录过期，请重新点扩展推送。`;
      } else {
        status.loggedIn = false;
        status.tip =
          '请先登录 seller.shopee.cn，再点击浏览器扩展 [KP工具合集助手] → [发送登录信息到本地工具]，然后点「刷新状态」。';
      }
    } catch {
      status.loggedIn = false;
      status.tip = '请确认本地服务已启动（双击 启动.bat），并刷新本页。';
    } finally {
      status.checking = false;
      refreshing.value = false;
      if (manual) {
        flash.value = false;
        flash.value = true;
      }
    }
  }

  // ---------- 店铺列表 ----------
  // 数据源：开放平台已授权店铺（/api/openapi/stores，店铺ID + 店铺名），唯一来源；
  // 原手工清单 config/stores.json 已删除（与真实授权店铺漂移，不再维护）。
  const stores = ref([]);
  const storesLoading = ref(false);
  const storesEmptyTip = ref(''); // 缓存里没有店铺时的去授权提示（区分「未配置 App」/「未授权店铺」）
  const selected = reactive(new Set());

  const selCount = computed(() => selected.size);

  // 缓存里没有店铺时，查开放平台状态区分原因，引导用户去授权（共享实现见 openapiEmptyTip.js）
  async function loadStores() {
    storesLoading.value = true;
    try {
      const r = await fetch('/api/openapi/stores');
      const d = await r.json();
      stores.value = Array.isArray(d) ? d : [];
      if (stores.value.length) {
        storesEmptyTip.value = '';
      } else {
        storesEmptyTip.value = await resolveOpenapiEmptyTip();
        ElMessage.warning(storesEmptyTip.value);
      }
    } catch {
      ElMessage.error('加载店铺失败，请确认服务已启动。');
    } finally {
      storesLoading.value = false;
    }
  }

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
