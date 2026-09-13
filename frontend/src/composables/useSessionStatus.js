// Shopee 卖家中心登录状态：查询 /api/status 并生成提示文案（bidding 系三页共用）。
import { ref, reactive } from 'vue';

export function useSessionStatus(readyTip = 'Cookie 已就绪，可直接选择店铺操作。') {
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
          '请先登录 seller.shopee.cn，再点击浏览器扩展 [电商工具箱] → [发送登录信息到工具]，然后点「刷新状态」。';
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

  return { status, refreshing, flash, refreshStatus };
}
