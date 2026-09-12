<!-- ② 选择店铺卡片：下拉多选（bidding / bidding-cancel / hotlisting-cancel 三页共用）
     selected 为 reactive Set，沿用「直接操作传入集合」的既有模式。
     支持：按国家/地区筛选 + 店铺名/店铺ID 搜索（下拉内输入即搜）+ 全选筛选结果 / 取消全选。 -->
<script setup>
import { computed, ref } from 'vue';
import { regionLabel } from '../region-utils.js';

const props = defineProps({
  stores: { type: Array, default: () => [] },
  selected: { type: Object, required: true }, // reactive Set<shopId>
  loading: { type: Boolean, default: false }, // 店铺列表加载中
  emptyTip: { type: String, default: '' }, // 缓存里没有店铺时的提示（引导去授权）
  reload: { type: Function, default: null }, // 重新加载店铺列表（授权完成后用）
});

// ---------- 国家/地区筛选 ----------
const regionFilter = ref('');
const regionOptions = computed(() => {
  const set = new Map(); // code -> 原始出现顺序去重
  for (const s of props.stores) {
    const code = String(s.region || '').toUpperCase();
    if (code && !set.has(code)) set.set(code, regionLabel(code));
  }
  return [...set.entries()].map(([value, label]) => ({ value, label }));
});

// ---------- 店铺名 / 店铺ID 搜索（下拉输入即搜，两个维度同时匹配） ----------
const keyword = ref('');
function onFilter(query) {
  keyword.value = String(query || '').trim();
}

const visibleStores = computed(() => {
  const kw = keyword.value.toLowerCase();
  return props.stores.filter((s) => {
    if (regionFilter.value && String(s.region || '').toUpperCase() !== regionFilter.value) return false;
    if (!kw) return true;
    return `${s.name || ''} ${s.id}`.toLowerCase().includes(kw);
  });
});

const isStoreVisible = (s) => visibleStores.value.includes(s);

// ---------- 多选（v-model 数组 ↔ reactive Set 互转） ----------
const checkedIds = computed(() => [...props.selected].map(String));

function onSelectionChange(vals) {
  const next = new Set((vals || []).map(String));
  for (const id of [...props.selected]) if (!next.has(id)) props.selected.delete(id);
  for (const id of next) props.selected.add(id);
}

function selectAllFiltered() {
  visibleStores.value.forEach((s) => props.selected.add(String(s.id)));
}

function clearAll() {
  props.selected.clear();
}

const selCount = computed(() => props.selected.size);
</script>

<template>
  <el-card shadow="never" class="card">
    <template #header>② 选择店铺</template>
    <div v-loading="loading" class="picker-box">
      <div class="picker-row">
        <el-select
          v-model="regionFilter"
          class="region-select"
          clearable
          placeholder="全部国家/地区"
        >
          <el-option v-for="r in regionOptions" :key="r.value" :value="r.value" :label="r.label" />
        </el-select>
        <el-select
          :model-value="checkedIds"
          class="store-select"
          multiple
          filterable
          collapse-tags
          collapse-tags-tooltip
          :filter-method="onFilter"
          placeholder="搜索店铺名 / 店铺ID，或下拉勾选店铺"
          @update:model-value="onSelectionChange"
        >
          <el-option
            v-for="s in stores"
            :key="s.id"
            :value="String(s.id)"
            :label="`${s.name}（${s.id}）`"
            :class="{ 'opt-filtered-out': !isStoreVisible(s) }"
          >
            <span class="opt-region">{{ s.region ? regionLabel(s.region) : '地区未知' }}</span>
            <span class="opt-name">{{ s.name }}</span>
            <span class="opt-id">ID: {{ s.id }}</span>
          </el-option>
        </el-select>
        <el-button @click="selectAllFiltered">全选筛选结果</el-button>
        <el-button :disabled="selCount === 0" @click="clearAll">取消全选</el-button>
        <span class="sel-hint">已选 {{ selCount }} / {{ stores.length }} 个店铺</span>
      </div>
      <div v-if="visibleStores.length === 0 && stores.length > 0" class="empty-tip">
        没有匹配的店铺：换个国家/地区或搜索关键词试试。
      </div>
      <!-- 缓存里没有任何店铺：给出去授权引导，而不是无限转圈 -->
      <div v-if="stores.length === 0 && !loading" class="empty-state">
        <div class="empty-tip">{{ emptyTip || '暂无已授权店铺：请先到「开放平台」Tab 完成 App 配置与店铺授权。' }}</div>
        <div class="empty-actions">
          <a href="/openapi/" target="_blank" rel="noopener">前往「开放平台」配置 / 授权 →</a>
          <el-button v-if="reload" size="small" @click="reload">重新加载</el-button>
        </div>
      </div>
    </div>
  </el-card>
</template>

<style scoped>
.picker-box { min-height: 56px; }
.picker-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.region-select { width: 170px; flex: none; }
.store-select { flex: 1 1 320px; min-width: 280px; }
.sel-hint { color: var(--text-3); font-size: var(--fs-xs); white-space: nowrap; }
.empty-tip { margin-top: var(--sp-2); color: var(--text-3); font-size: var(--fs-xs); }
.empty-state {
  margin-top: var(--sp-1);
  padding: 10px var(--sp-3);
  border: 1px dashed var(--border);
  border-radius: var(--radius-sm);
  background: var(--surface-2);
}
.empty-state .empty-tip { margin: 0 0 var(--sp-2); color: var(--text-2); }
.empty-actions { display: flex; align-items: center; gap: var(--sp-3); }
.empty-actions a { font-size: var(--fs-sm); color: var(--el-color-primary); text-decoration: none; }
.empty-actions a:hover { text-decoration: underline; }
.opt-region {
  display: inline-block;
  min-width: 82px;
  margin-right: var(--sp-2);
  font-size: var(--fs-xs);
  color: var(--text-3);
}
.opt-name { font-size: var(--fs-sm); }
.opt-id { margin-left: var(--sp-2); font-size: var(--fs-xs); color: var(--text-3); }
/* 被国家/关键词筛掉的选项仍要渲染（保住已选标签的名称），只是在下拉里隐藏 */
.opt-filtered-out { display: none; }
</style>
