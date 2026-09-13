// Shopee 取消注册 Hot Listing：SPU 配置子系统（组合式函数）。
// 职责：读写 /api/hotlisting-cancel/spu-config、输入防抖自动保存、已选店铺派生计数、
// 配置区搜索筛选、以及「本次未选」的历史配置折叠列表。UI 见 SpuConfigCard.vue。
import { ref, computed, onMounted } from 'vue';
import { ElMessage } from 'element-plus';
import { getJson, postJson } from '../composables/api.js';

const CONFIG_URL = '/api/hotlisting-cancel/spu-config';

/**
 * @param {object} o
 *   - stores   Ref<Array> 授权店铺列表（来自 useShopeeSession）
 *   - selected reactive Set<shopId> 本次勾选的店铺
 */
export function useSpuConfig({ stores, selected }) {
  // 关键约束：spuMap 始终保存**全量**配置（含未选店铺），只在渲染层过滤；
  // 少传键＝删配置，因此回传后端时必须是完整对象。
  const spuMap = ref({});          // { shopId: spuId }
  const saveState = ref('');       // '' | 'saving' | 'saved' | 'error'
  let saveTimer = null;

  function shopSpuId(shopId) {
    return String(spuMap.value[shopId] || '').trim();
  }

  // 已选店铺（顺序跟随店铺列表）→ 配置区只渲染这些行
  const selectedStores = computed(() => stores.value.filter(s => selected.has(String(s.id))));

  // 已选店铺中已配置 / 待填写 SPU 的店铺数
  const configuredSelCount = computed(() => selectedStores.value.filter(s => shopSpuId(s.id) !== '').length);
  const pendingCount = computed(() => selectedStores.value.length - configuredSelCount.value);

  // 配置区内搜索 + 状态筛选（已选很多时用来快速定位）
  const spuKeyword = ref('');
  const spuFilter = ref('');       // '' | 'set' | 'unset'
  const visibleSpuStores = computed(() => {
    const kw = spuKeyword.value.trim().toLowerCase();
    return selectedStores.value.filter((s) => {
      const has = shopSpuId(s.id) !== '';
      if (spuFilter.value === 'set' && !has) return false;
      if (spuFilter.value === 'unset' && has) return false;
      if (!kw) return true;
      return `${s.name || ''} ${s.id}`.toLowerCase().includes(kw);
    });
  });

  // 历史配置：spuMap 里有值、但本次未勾选的店铺（含已不在授权列表里的旧店铺）。
  const savedElsewhere = computed(() => {
    const known = new Map(stores.value.map(s => [String(s.id), String(s.name || '')]));
    const out = [];
    for (const [id, v] of Object.entries(spuMap.value)) {
      const text = String(v || '').trim();
      if (!text || selected.has(id)) continue;
      out.push({ id, spu: text, name: known.get(id) || '', inStores: known.has(id) });
    }
    // 仍能匹配到店铺名的排在前面
    return out.sort((a, b) => (a.inStores === b.inStores ? 0 : (a.inStores ? -1 : 1)));
  });

  function setSpu(shopId, value) {
    spuMap.value[shopId] = value;
    onSpuInput();
  }

  function clearSpu(shopId) {
    delete spuMap.value[shopId];
    onSpuInput();
  }

  async function loadSpuConfig() {
    try {
      const j = await getJson(CONFIG_URL);
      if (j && j.ok) spuMap.value = j.map || {};
    } catch { /* 加载失败不阻塞页面，保存时会再提示 */ }
  }

  async function saveSpuConfig() {
    saveState.value = 'saving';
    try {
      const j = await postJson(CONFIG_URL, { map: spuMap.value });
      if (j && j.ok) {
        spuMap.value = j.map || spuMap.value; // 以归一化结果为准
        saveState.value = 'saved';
        setTimeout(() => { if (saveState.value === 'saved') saveState.value = ''; }, 1500);
      } else {
        saveState.value = 'error';
        ElMessage.error((j && j.msg) || 'SPU 配置保存失败');
      }
    } catch (e) {
      saveState.value = 'error';
      ElMessage.error('SPU 配置保存失败：' + e.message);
    }
  }

  // 输入变化 → 防抖自动保存（800ms）
  function onSpuInput() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(saveSpuConfig, 800);
  }

  onMounted(loadSpuConfig);

  return {
    spuMap, saveState, shopSpuId, setSpu, clearSpu, loadSpuConfig, saveSpuConfig,
    selectedStores, configuredSelCount, pendingCount,
    spuKeyword, spuFilter, visibleSpuStores, savedElsewhere,
  };
}
