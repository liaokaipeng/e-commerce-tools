// 视频上传页 · 凭证管理：站点解析、本地缓存、服务端凭证同步、跨境多店铺选择。
// 从 video/App.vue 抽出（原 596 行单文件混了凭证 / 表格解析 / 上传三块职责）。
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
import { ElMessage } from 'element-plus';
import { resolveOpenapiEmptyTip } from '../composables/openapiEmptyTip.js';

/** 站点配置（门户已按站点拆成「跨境」「本土」两个入口，本页由 ?mode=cn|ph 固定） */
export const SITES = {
  cn: { key: 'cn', label: '跨境（.cn）' },
  ph: { key: 'ph', label: '本土-菲律宾（.ph）' },
};

export function useVideoCreds() {
  const modeParam = new URLSearchParams(window.location.search).get('mode');
  const site = ref(SITES[modeParam] ? modeParam : 'cn');
  const isPh = computed(() => site.value === 'ph');
  const siteLabel = computed(() => SITES[site.value].label);

  const auth = ref('');
  const cookie = ref('');
  const shopId = ref('');
  const userid = ref('');
  const refreshingCreds = ref(false);

  // 跨境 cn 多店铺：有凭证的店铺列表与当前选中店铺
  const cnShops = ref([]); // [{ shopId, auth, cookie, userid, updatedAt, hasCred }]
  const selectedShopId = ref('');
  const stores = ref([]);

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

  function saveCreds() {
    // 跨境 cn 凭证由扩展抓取、按店铺存于服务端，本地仅记住所选店铺；本土 ph 完整记住凭证
    const data = isPh.value
      ? { auth: auth.value, cookie: cookie.value, shopId: shopId.value, userid: userid.value }
      : { shopId: shopId.value || selectedShopId.value };
    localStorage.setItem(`shopee_creds_${site.value}`, JSON.stringify(data));
  }

  function loadLocalCreds() {
    let c = {};
    try { c = JSON.parse(localStorage.getItem(`shopee_creds_${site.value}`) || '{}'); } catch { c = {}; }
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

  // userid 输入框获得焦点时不覆盖用户正在输入的值
  function setUseridIfNotFocused(v) {
    const el = document.getElementById('userid');
    if (el && v && document.activeElement !== el) userid.value = v;
  }

  const CREDS_KEY = (s) => `shopee_creds_${s}`;

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

  /** 执行上传前的凭证校验；返回 false 表示缺凭证（已提示用户） */
  function assertReady() {
    saveCreds();
    if (isPh.value && !cookie.value.trim()) {
      ElMessage.warning('尚未获取到该站点凭证：请安装扩展，登录卖家中心并在短视频页手动上传一次以自动抓取');
      return false;
    }
    if (!isPh.value && !cnShops.value.some((s) => s.hasCred)) {
      ElMessage.warning('尚未获取到跨境凭证：请安装扩展，在任一店铺短视频页手动上传一次以自动抓取（凭证账号级通用）');
      return false;
    }
    if (isPh.value && !userid.value.trim()) {
      ElMessage.warning('本土站点请填写 User ID（扩展会自动抓取，若为空请手动填写）');
      return false;
    }
    if (!isPh.value && !shopId.value.trim()) {
      ElMessage.warning('未识别到可用的跨境店铺：请安装扩展，在任一店铺短视频页手动上传一次以自动抓取凭证');
      return false;
    }
    return true;
  }

  // 店铺列表与竞价导出等页面同源：开放平台已授权店铺（/api/openapi/stores，
  // 真实店名 + 全量授权店铺，取名缺失时后端自动调 get_shop_info 补拉），唯一来源。
  // 未配置开放平台或请求异常时列表保持为空（页面仍可用，仅需手工填 Shop ID）。
  async function loadStoreList() {
    try {
      const r = await fetch('/api/openapi/stores');
      const d = await r.json();
      stores.value = Array.isArray(d) ? d : [];
    } catch { /* 服务未启动忽略 */ }
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
