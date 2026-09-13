// 视频上传页 · 服务端凭证同步：拉取 /api/creds 合并到内存状态、定时静默轮询、
// 空店铺态提示与手动刷新。凭证由扩展推送到服务端，本模块负责页面侧同步。
import { ref, watch } from 'vue';
import { ElMessage } from 'element-plus';
import { resolveOpenapiEmptyTip } from '../composables/openapiEmptyTip.js';

/**
 * @param {object} deps 由 useVideoCreds 聚合器注入的状态与其它模块函数
 */
export function useVideoCredSync({
  isPh,
  auth, cookie, shopId, userid, selectedShopId, cnShops, refreshingCreds,
  shopOptions,
  saveCreds, loadLocalCreds, wipeLocalCreds, loadStoreList,
}) {
  // ---------- 缓存里没有店铺时的去授权提示（跨境 cn 下拉为空时显示） ----------
  const shopEmptyTip = ref('');
  let shopEmptyWarned = false; // 同一段空档期只弹一次 warning
  let initialLoaded = false; // 首次凭证+店铺列表加载完成前不判空：挂载瞬间下拉必然为空（数据还没回来），是竞态不是真没店铺

  async function checkShopEmpty() {
    if (isPh.value) return; // 本土页没有店铺下拉
    const opts = shopOptions.value;
    if (opts.length) {
      shopEmptyTip.value = '';
      shopEmptyWarned = false;
      return;
    }
    if (!initialLoaded || shopEmptyTip.value) return; // 首次加载未完成 / 已解析过原因，不重复处理
    shopEmptyTip.value = await resolveOpenapiEmptyTip();
    if (!shopEmptyWarned) {
      ElMessage.warning(shopEmptyTip.value);
      shopEmptyWarned = true;
    }
  }
  watch(shopOptions, () => { checkShopEmpty(); });

  // userid 输入框获得焦点时不覆盖用户正在输入的值
  function setUseridIfNotFocused(v) {
    const el = document.getElementById('userid');
    if (el && v && document.activeElement !== el) userid.value = v;
  }

  async function loadCredsFromServer(quiet) {
    try {
      const r = await fetch('/api/creds');
      const c = await r.json();
      const sites = (c && c.sites) || {};
      if (isPh.value) {
        const cur = sites.ph || null;
        if (cur && (cur.auth || cur.cookie || cur.shopId || cur.userid)) {
          // auth/cookie 已无可见输入框，不会被用户编辑，直接从服务端同步
          if (cur.auth) auth.value = cur.auth;
          if (cur.cookie) cookie.value = cur.cookie;
          setUseridIfNotFocused(cur.userid);
          if (!quiet) saveCreds();
        } else if (auth.value || cookie.value || userid.value) {
          // 服务端本土凭证为空（可能已被清空缓存）：同步清空页面本地残留
          wipeLocalCreds();
        }
      } else {
        const shopsMap = (sites.cn && sites.cn.shops) || {};
        const list = Object.entries(shopsMap)
          .map(([id, v]) => {
            const a = (v && v.auth) || '';
            const ck = (v && v.cookie) || '';
            return {
              shopId: id,
              auth: a,
              cookie: ck,
              userid: (v && v.userid) || '',
              updatedAt: (v && v.updatedAt) || 0,
              hasCred: !!(a || ck),
            };
          })
          .sort((a, b) => Number(b.hasCred) - Number(a.hasCred));
        cnShops.value = list;
        if (!list.length) {
          // 服务端跨境凭证为空（可能已被清空缓存）：只清凭证材料，保留用户所选店铺。
          // 未抓到凭证的店铺本就是合法选择目标（复用同账号凭证发布），若在这里连选择
          // 一起抹掉，5 秒一次的同步会把用户刚选好的店铺打回空（下拉框"变空"）。
          auth.value = '';
          cookie.value = '';
          userid.value = '';
          cnShops.value = [];
          return;
        }
        if (list.length) {
          // 优先沿用当前所选店铺（用户手动选择或上次记住的），未选择时自动挑最近更新的有凭证店铺
          const withCred = list
            .filter((x) => x.hasCred)
            .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
          const cur = selectedShopId.value ? list.find((x) => x.shopId === selectedShopId.value) : null;
          if (cur) {
            if (cur.auth) auth.value = cur.auth;
            if (cur.cookie) cookie.value = cur.cookie;
            shopId.value = cur.shopId;
            if (cur.userid) userid.value = cur.userid;
            if (!quiet) saveCreds();
          } else if (selectedShopId.value) {
            // 所选店铺未抓到凭证：保留选择（可能是已授权店铺列表里的店铺），凭证沿用最近更新的有凭证店铺
            shopId.value = selectedShopId.value;
            const src = withCred[0];
            if (src) {
              if (src.auth) auth.value = src.auth;
              if (src.cookie) cookie.value = src.cookie;
              if (src.userid) userid.value = src.userid;
            }
            if (!quiet) saveCreds();
          } else if (withCred[0] || list[0]) {
            const pick = withCred[0] || list[0];
            selectedShopId.value = pick.shopId;
            if (pick.auth) auth.value = pick.auth;
            if (pick.cookie) cookie.value = pick.cookie;
            shopId.value = pick.shopId;
            if (pick.userid) userid.value = pick.userid;
            if (!quiet) saveCreds();
          }
        }
      }
    } catch {
      /* 服务未启动忽略 */
    }
  }

  async function refreshCreds() {
    refreshingCreds.value = true;
    await Promise.all([loadCredsFromServer(false), loadStoreList()]); // 店铺列表一并重载：刚完成开放平台授权后点此即可看到新店铺
    refreshingCreds.value = false;
    // 手动刷新后给出明确反馈：按钮变主色只是焦点态，别让用户误以为报错
    if (isPh.value) {
      if (auth.value.trim() || cookie.value.trim()) {
        ElMessage.success('凭证已刷新');
      } else {
        ElMessage.warning('服务端暂无本土凭证：请安装扩展，登录卖家中心并在短视频页手动上传一次以自动抓取');
      }
    } else {
      const n = cnShops.value.filter((s) => s.hasCred).length;
      if (n) {
        ElMessage.success(`凭证已刷新：共 ${n} 个店铺有凭证`);
      } else {
        ElMessage.warning('服务端暂无跨境凭证：请安装扩展，在任一店铺短视频页手动上传一次以自动抓取');
      }
    }
  }

  function startStoreSync() {
    loadLocalCreds();
    // 首次加载完成后才允许判空提示（挂载瞬间下拉必然为空，不能当成「没店铺」弹告警）
    Promise.all([loadCredsFromServer(true), loadStoreList()])
      .then(() => { initialLoaded = true; checkShopEmpty(); })
      .catch(() => { initialLoaded = true; checkShopEmpty(); });
    // 凭证由扩展推送到服务端，定时静默同步（用户在本页编辑的输入不受影响）
    return setInterval(() => loadCredsFromServer(true), 5000);
  }

  return { shopEmptyTip, loadCredsFromServer, refreshCreds, checkShopEmpty, startStoreSync };
}
