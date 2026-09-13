// 开放平台已授权店铺列表（/api/openapi/stores，唯一来源；真实店名 + 全量授权店铺）。
// bidding / bidding-cancel / hotlisting-cancel / video 四个页面共用。
import { ref } from 'vue';
import { ElMessage } from 'element-plus';
import { resolveOpenapiEmptyTip } from './openapiEmptyTip.js';

/**
 * @param {{ emptyTip?: boolean, errorToast?: boolean }} [opts]
 *   - emptyTip：列表为空时解析并弹出「去授权」提示（区分「未配置 App」/「未授权店铺」）
 *   - errorToast：请求异常时弹出错误提示（视频页为静默失败，保持默认 false）
 */
export function useOpenapiStores({ emptyTip = false, errorToast = false } = {}) {
  const stores = ref([]);
  const storesLoading = ref(false);
  const storesEmptyTip = ref('');

  async function loadStores() {
    storesLoading.value = true;
    try {
      const r = await fetch('/api/openapi/stores');
      const d = await r.json();
      stores.value = Array.isArray(d) ? d : [];
      if (emptyTip) {
        if (stores.value.length) {
          storesEmptyTip.value = '';
        } else {
          storesEmptyTip.value = await resolveOpenapiEmptyTip();
          ElMessage.warning(storesEmptyTip.value);
        }
      }
    } catch {
      if (errorToast) ElMessage.error('加载店铺失败，请确认服务已启动。');
    } finally {
      storesLoading.value = false;
    }
  }

  return { stores, storesLoading, storesEmptyTip, loadStores };
}
