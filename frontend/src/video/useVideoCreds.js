// 视频上传页 · 凭证管理：站点解析、本地缓存、服务端凭证同步、跨境多店铺选择。
// 从 video/App.vue 抽出（原 596 行单文件混了凭证 / 表格解析 / 上传三块职责）。
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { ElMessage } from 'element-plus';

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
  // 店铺下拉选项：展示全部已知店铺，无凭证的加标注
  const shopOptions = computed(() => cnShops.value.map((s) => {
    const base = shopNameOf(s.shopId) ? `${shopNameOf(s.shopId)}（${s.shopId}）` : `店铺 ${s.shopId}`;
    return { value: s.shopId, label: s.hasCred ? base : `${base}（无凭证，需上传一次）` };
  }));

  function applyShop(id) {
    const s = cnShops.value.find((x) => x.shopId === String(id));
    if (!s) return;
    auth.value = s.auth || '';
    cookie.value = s.cookie || '';
    shopId.value = s.shopId;
    userid.value = s.userid || '';
    saveCreds();
    if (!s.hasCred) {
      ElMessage.warning(`店铺 ${s.shopId} 暂无有效凭证，请登录同账号下任一店铺短视频页手动上传一次以抓取凭证（凭证账号级通用）`);
    }
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
        if (list.length) {
          // 优先沿用当前所选店铺（用户手动选择或上次记住的），未选择时自动挑最近更新的有凭证店铺
          const withCred = list
            .filter((x) => x.hasCred)
            .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
          let cur = selectedShopId.value ? list.find((x) => x.shopId === selectedShopId.value) : null;
          if (!cur) cur = withCred[0] || list[0];
          if (selectedShopId.value !== cur.shopId) {
            selectedShopId.value = cur.shopId;
            saveCreds();
          }
          if (cur.auth) auth.value = cur.auth;
          if (cur.cookie) cookie.value = cur.cookie;
          shopId.value = cur.shopId;
          if (cur.userid) userid.value = cur.userid;
          if (!quiet) saveCreds();
        }
      }
    } catch {
      /* 服务未启动忽略 */
    }
  }

  async function refreshCreds() {
    refreshingCreds.value = true;
    await loadCredsFromServer(false);
    refreshingCreds.value = false;
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

  function startStoreSync() {
    loadLocalCreds();
    loadCredsFromServer(true);
    fetch('/api/stores')
      .then((r) => r.json())
      .then((d) => { stores.value = Array.isArray(d) ? d : []; })
      .catch(() => { /* 服务未启动忽略 */ });
    // 凭证由扩展推送到服务端，定时静默同步（用户在本页编辑的输入不受影响）
    return setInterval(() => loadCredsFromServer(true), 5000);
  }

  return {
    site, isPh, siteLabel,
    auth, cookie, shopId, userid, refreshingCreds,
    cnShops, selectedShopId, stores, shopOptions, shopNameOf,
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
