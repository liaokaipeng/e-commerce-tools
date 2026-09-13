// 视频上传页 · 凭证聚合器：创建站点/凭证状态，装配各高内聚子模块，
// 对外导出与拆分前完全一致的键名与行为（消费者按名解构）。
// 子模块职责：
//   useVideoSite.js       站点派生（?mode=cn|ph → site / isPh / siteLabel）
//   useVideoCredsStore.js 本地缓存（localStorage 读写与清空）
//   useVideoStores.js     店铺列表 / 下拉选项 / 区域 / 选中回填
//   useVideoCredSync.js   服务端同步 / 定时轮询 / 空态提示 / 手动刷新
//   useVideoCredGuard.js  上传前就绪校验与提示
import { ref, onMounted, onUnmounted } from 'vue';
import { SITES, useVideoSite } from './useVideoSite.js';
import { useVideoCredsStore } from './useVideoCredsStore.js';
import { useVideoStores } from './useVideoStores.js';
import { useVideoCredSync } from './useVideoCredSync.js';
import { useVideoCredGuard } from './useVideoCredGuard.js';

export { SITES };

export function useVideoCreds() {
  const { site, isPh, siteLabel } = useVideoSite();

  const auth = ref('');
  const cookie = ref('');
  const shopId = ref('');
  const userid = ref('');
  const refreshingCreds = ref(false);

  // 跨境 cn 多店铺：有凭证的店铺列表与当前选中店铺
  const cnShops = ref([]); // [{ shopId, auth, cookie, userid, updatedAt, hasCred }]
  const selectedShopId = ref('');

  const { saveCreds, loadLocalCreds, wipeLocalCreds } = useVideoCredsStore({
    site, isPh, auth, cookie, shopId, userid, selectedShopId, cnShops,
  });

  const { stores, shopNameOf, shopRegionOf, shopOptions, applyShop, loadStoreList } = useVideoStores({
    cnShops, shopId, selectedShopId, auth, cookie, userid, saveCreds,
  });

  const { shopEmptyTip, refreshCreds, startStoreSync } = useVideoCredSync({
    isPh,
    auth, cookie, shopId, userid, selectedShopId, cnShops, refreshingCreds,
    shopOptions,
    saveCreds, loadLocalCreds, wipeLocalCreds, loadStoreList,
  });

  const { assertReady } = useVideoCredGuard({ isPh, cookie, userid, cnShops, shopId, saveCreds });

  return {
    site, isPh, siteLabel,
    auth, cookie, shopId, userid, refreshingCreds,
    cnShops, selectedShopId, stores, shopOptions, shopNameOf, shopRegionOf, shopEmptyTip,
    applyShop, saveCreds, refreshCreds, assertReady, startStoreSync,
  };
}

/** 页面标题与凭证定时同步的生命周期挂载（供 App.vue 直接调用） */
export function useVideoPageLifecycle(creds) {
  let credsTimer = null;
  onMounted(() => {
    document.title = creds.isPh.value ? '本土视频批量上传' : '跨境视频批量上传';
    credsTimer = creds.startStoreSync();
  });
  onUnmounted(() => {
    if (credsTimer) clearInterval(credsTimer);
  });
}
