// 视频上传页 · 本地凭证缓存（localStorage）：按站点读写与清空，不碰服务端。
// 服务端同步由 useVideoCredSync 负责，本模块只管理浏览器本地镜像。

const CREDS_KEY = (s) => `shopee_creds_${s}`;

/**
 * @param {{ site, isPh, auth, cookie, shopId, userid, selectedShopId, cnShops }} state 聚合器持有的凭证状态
 */
export function useVideoCredsStore({ site, isPh, auth, cookie, shopId, userid, selectedShopId, cnShops }) {
  function saveCreds() {
    // 跨境 cn 凭证由扩展抓取、按店铺存于服务端，本地仅记住所选店铺；本土 ph 完整记住凭证
    const data = isPh.value
      ? { auth: auth.value, cookie: cookie.value, shopId: shopId.value, userid: userid.value }
      : { shopId: shopId.value || selectedShopId.value };
    localStorage.setItem(CREDS_KEY(site.value), JSON.stringify(data));
  }

  function loadLocalCreds() {
    let c = {};
    try { c = JSON.parse(localStorage.getItem(CREDS_KEY(site.value)) || '{}'); } catch { c = {}; }
    // 跨境 cn：页面无店铺控件，仅记住上次自动选中的店铺，保持发布目标稳定
    if (!isPh.value) {
      auth.value = '';
      cookie.value = '';
      shopId.value = '';
      userid.value = '';
      selectedShopId.value = c.shopId || '';
      return;
    }
    auth.value = c.auth || '';
    cookie.value = c.cookie || '';
    shopId.value = c.shopId || '';
    userid.value = c.userid || '';
    selectedShopId.value = c.shopId || '';
  }

  function wipeLocalCreds() {
    // 服务端该站点凭证已被清空（如扩展「缓存清理」）：页面内存与本地镜像一并清掉，
    // 避免服务端已空而页面仍拿旧凭证上传。localStorage 只存服务端同步来的数据，清了不丢用户输入。
    auth.value = '';
    cookie.value = '';
    shopId.value = '';
    userid.value = '';
    selectedShopId.value = '';
    cnShops.value = [];
    localStorage.removeItem(CREDS_KEY(site.value));
  }

  return { saveCreds, loadLocalCreds, wipeLocalCreds };
}
