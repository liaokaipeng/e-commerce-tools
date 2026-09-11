// Shopee 会话组合式函数：登录状态轮询 + 店铺列表与勾选集合。
// bidding / bidding-cancel / hotlisting-cancel / product-export 四页共用。
// 注意：店铺的分组与勾选渲染由 StorePicker 组件承担，这里只维护 selected 集合本身。
import { ref, reactive, computed, onMounted, onUnmounted } from 'vue';
import { ElMessage } from 'element-plus';

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
  const stores = ref([]);
  const selected = reactive(new Set());

  const selCount = computed(() => selected.size);

  async function loadStores() {
    try {
      const r = await fetch('/api/stores');
      stores.value = await r.json();
    } catch {
      ElMessage.error('加载店铺失败，请确认服务已启动。');
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
    stores, selected, selCount, clearAll,
  };
}
