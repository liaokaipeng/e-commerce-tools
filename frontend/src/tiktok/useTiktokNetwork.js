// TikTok 下载页 · 代理/网络检测：探测系统代理状态、展示网络提示与重新检测。
import { ref } from 'vue';

/**
 * 代理/网络检测子系统。
 * @param {object} o
 *   - log       页面日志函数（重新检测后记录提示）
 *   - onStatus  探测成功后的回调，接收 /api/tiktok/status 返回数据（供页面回填默认目录等编排）
 * @returns {{ proxyConnected: Ref<boolean>, proxyText: Ref<string>, showVpn: Ref<boolean>,
 *             checkNetwork: () => Promise<void>, recheckNetwork: () => Promise<void> }}
 */
export function useTiktokNetwork({ log = () => {}, onStatus } = {}) {
  const proxyConnected = ref(true);
  const proxyText = ref('正在检测网络环境...');
  const showVpn = ref(false);

  async function checkNetwork() {
    try {
      const r = await fetch('/api/tiktok/status');
      const data = await r.json();
      const proxyInfo = data.proxy;
      if (onStatus) onStatus(data);
      proxyConnected.value = true;
      proxyText.value = proxyInfo
        ? `已检测到代理：${proxyInfo}（VPN/代理已开启，可直接下载）`
        : '未检测到系统代理，将尝试直连访问 TikTok（如失败请开启 VPN）';
      showVpn.value = false;
    } catch {
      proxyConnected.value = false;
      proxyText.value = '服务未连接，请确认已启动 main.js';
    }
  }

  async function recheckNetwork() {
    await checkNetwork();
    log('已重新检测网络环境', 'info');
  }

  return { proxyConnected, proxyText, showVpn, checkNetwork, recheckNetwork };
}
