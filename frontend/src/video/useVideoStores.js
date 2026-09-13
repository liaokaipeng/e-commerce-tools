// 视频上传页 · 店铺列表与选项：拉取开放平台已授权店铺，派生店名 / 地区 / 下拉选项，
// 并提供「选中店铺 → 回填凭证」的 applyShop。与竞价导出等页面同源（/api/openapi/stores）。
import { computed } from 'vue';
import { ElMessage } from 'element-plus';
import { useOpenapiStores } from '../composables/useOpenapiStores.js';

/**
 * @param {{ cnShops, shopId, selectedShopId, auth, cookie, userid, saveCreds }} state 聚合器持有的凭证状态
 */
export function useVideoStores({ cnShops, shopId, selectedShopId, auth, cookie, userid, saveCreds }) {
  // 店铺列表与竞价导出等页面同源（/api/openapi/stores）；未配置开放平台或请求异常时保持为空，
  // 页面仍可用（仅需手工填 Shop ID），故不弹提示。
  const { stores, loadStores } = useOpenapiStores();

  const shopNameOf = (id) => {
    const s = stores.value.find((x) => String(x.id) === String(id));
    return s ? s.name : '';
  };

  // 店铺地区（国家筛选用）：来自 /api/openapi/stores 的 region 字段；查不到返回空串
  const shopRegionOf = (id) => {
    const s = stores.value.find((x) => String(x.id) === String(id));
    return s && s.region ? String(s.region).toUpperCase() : '';
  };

  // 店铺下拉选项：展示全部已知店铺（已抓凭证的排前面），无凭证的加标注。
  // 凭证账号级通用：未抓到凭证的店铺也可选（复用同账号已抓凭证发布），
  // 否则「任一店铺手动上传一次 → 同账号所有店铺可批量上传」落不了地。
  const shopOptions = computed(() => {
    const out = [];
    const seen = new Set();
    const add = (shopId, name, hasCred) => {
      if (!shopId || seen.has(shopId)) return;
      seen.add(shopId);
      const base = name ? `${name}（${shopId}）` : `店铺 ${shopId}`;
      out.push({
        value: shopId,
        label: hasCred ? base : `${base}（未抓到凭证，复用同账号凭证）`,
        region: shopRegionOf(shopId),
      });
    };
    for (const s of cnShops.value) if (s.hasCred) add(s.shopId, shopNameOf(s.shopId), true);
    for (const s of cnShops.value) if (!s.hasCred) add(s.shopId, shopNameOf(s.shopId), false);
    for (const st of stores.value) add(String(st.id), st.name || '', false);
    return out;
  });

  function applyShop(id) {
    const sid = String(id);
    shopId.value = sid;
    selectedShopId.value = sid;
    const s = cnShops.value.find((x) => x.shopId === sid);
    if (s && s.hasCred) {
      auth.value = s.auth || '';
      cookie.value = s.cookie || '';
      userid.value = s.userid || '';
    } else {
      // 该店铺未抓到凭证：保留当前同账号凭证，仅切换发布目标
      ElMessage.warning(`店铺 ${sid} 未抓到凭证，将复用同账号已抓取的凭证发布；如失败请在该店铺短视频页手动上传一次`);
    }
    saveCreds();
  }

  return { stores, shopNameOf, shopRegionOf, shopOptions, applyShop, loadStoreList: loadStores };
}
