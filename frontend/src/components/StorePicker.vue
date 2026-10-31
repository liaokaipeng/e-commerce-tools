<!-- ② 选择店铺卡片：下拉多选（bidding / bidding-cancel / hotlisting-cancel 三页共用）
     selected 为 reactive Set，沿用「直接操作传入集合」的既有模式。
     支持：按国家/地区筛选 + 店铺名/店铺ID 搜索（下拉内输入即搜）+ 全选筛选结果 / 取消全选。 -->
<script setup>
import { computed } from 'vue';
import StepCard from './StepCard.vue';
import { regionLabel } from '../region-utils.js';
import { useShopFilter } from '../composables/useShopFilter.js';
import OpenapiGuide from './OpenapiGuide.vue';

const props = defineProps({
  stores: { type: Array, default: () => [] },
  selected: { type: Object, required: true }, // reactive Set<shopId>
  loading: { type: Boolean, default: false }, // 店铺列表加载中
  emptyTip: { type: String, default: '' }, // 缓存里没有店铺时的提示（引导去授权）
  reload: { type: Function, default: null }, // 重新加载店铺列表（授权完成后用）
});

const items = computed(() => props.stores);
const { regionFilter, regionOptions, onFilter, visible: visibleStores } =
  useShopFilter({ items, regionOf: (s) => s.region, textOf: (s) => `${s.name || ''} ${s.id}` });

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
  <StepCard :index="2" title="选择店铺">
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
      <OpenapiGuide v-if="stores.length === 0 && !loading" :tip="emptyTip || '暂无已授权店铺：请先到「开放平台」Tab 完成 App 配置与店铺授权。'" :reload="reload" />
    </div>
  </StepCard>
</template>

<style scoped>
.picker-box { min-height: 56px; }
.picker-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.region-select { width: 170px; flex: none; }
.store-select { flex: 1 1 320px; min-width: 280px; }
.sel-hint { color: var(--text-3); font-size: var(--fs-xs); white-space: nowrap; }
.empty-tip { margin-top: var(--sp-2); color: var(--text-3); font-size: var(--fs-xs); }
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
