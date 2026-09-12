<!-- 视频上传 · ① 凭证卡片与 ② 表格卡片（展示层）。
     状态与逻辑在 video/useVideoCreds.js / useVideoTable.js，本组件只负责渲染与事件上抛。 -->
<script setup>
import { computed, ref } from 'vue';
import { UploadFilled } from '@element-plus/icons-vue';
import { regionLabel } from '../region-utils.js';
import { STATUS_TEXT } from './useVideoTable.js';

const props = defineProps({
  isPh: { type: Boolean, default: false },
  refreshingCreds: { type: Boolean, default: false },
  /** 跨境多店铺下拉：[{ value, label, region }] */
  shopOptions: { type: Array, default: () => [] },
  /** 下拉没有任何店铺时的去授权提示（缓存里没有店铺） */
  shopEmptyTip: { type: String, default: '' },
  selectedShopId: { type: String, default: '' },
  userid: { type: String, default: '' },
  /** 表格 */
  rows: { type: Array, default: () => [] },
  uploadRef: { type: Object, default: null },
});

const emit = defineEmits([
  'refresh-creds', 'update:selectedShopId', 'update:userid', 'apply-shop',
  'file-change', 'file-exceed', 'file-remove', 'parse', 'download-template',
]);

// ---------- 跨境店铺选择：国家/地区筛选 + 店铺名/店铺ID 搜索 ----------
const shopRegionFilter = ref('');
const shopKeyword = ref('');
function onShopFilter(query) {
  shopKeyword.value = String(query || '').trim();
}

const shopRegionOptions = computed(() => {
  const seen = new Map();
  for (const o of props.shopOptions) {
    const code = String(o.region || '').toUpperCase();
    if (code && !seen.has(code)) seen.set(code, regionLabel(code));
  }
  return [...seen.entries()].map(([value, label]) => ({ value, label }));
});

const visibleShopOptions = computed(() => {
  const kw = shopKeyword.value.toLowerCase();
  return props.shopOptions.filter((o) => {
    if (shopRegionFilter.value && String(o.region || '').toUpperCase() !== shopRegionFilter.value) return false;
    if (!kw) return true;
    return o.label.toLowerCase().includes(kw); // label 含「店名（店铺ID）」，一个关键词同时匹配两维
  });
});

// 状态列：初始为空（不渲染标签）；no-product = 后端判定「商品为空」跳过上传。
// 文案 STATUS_TEXT 共享自 useVideoTable.js（导出结果表格用同一份）
const STATUS_TAG = { run: 'warning', ok: 'success', err: 'danger', 'no-product': 'danger' };
const statusTag = (t) => STATUS_TAG[t] || 'info';
const statusText = (t) => STATUS_TEXT[t] || '';
</script>

<template>
  <!-- 凭证 -->
  <el-card shadow="never" class="card">
    <template #header><span>上传凭证</span></template>
    <div v-if="!isPh" class="row shop-row">
      <el-select
        v-model="shopRegionFilter"
        class="shop-region-select"
        clearable
        placeholder="全部国家/地区"
      >
        <el-option v-for="r in shopRegionOptions" :key="r.value" :value="r.value" :label="r.label" />
      </el-select>
      <el-select
        :model-value="selectedShopId"
        class="shop-select"
        filterable
        :filter-method="onShopFilter"
        placeholder="搜索店铺名 / 店铺ID，或下拉选择要发布到的店铺"
        @update:model-value="(v) => { emit('update:selectedShopId', v); emit('apply-shop', v); }"
      >
        <el-option
          v-for="o in shopOptions"
          :key="o.value"
          :value="o.value"
          :label="o.label"
          :class="{ 'opt-filtered-out': !visibleShopOptions.includes(o) }"
        >
          <span class="opt-region">{{ o.region ? regionLabel(o.region) : '地区未知' }}</span>
          <span class="opt-label">{{ o.label }}</span>
        </el-option>
      </el-select>
    </div>
    <!-- 缓存里没有任何店铺：给出去授权引导，而不是空下拉 -->
    <div v-if="!isPh && shopOptions.length === 0 && shopEmptyTip" class="shop-empty-state">
      <div class="shop-empty-tip">{{ shopEmptyTip }}</div>
      <a href="/openapi/" target="_blank" rel="noopener">前往「开放平台」配置 / 授权 →</a>
    </div>
    <div v-if="isPh" class="row">
      <span class="field-label">User ID（本土上传需要，扩展会自动抓取，若为空请手动填写）</span>
      <el-input
        id="userid"
        :model-value="userid"
        style="max-width: 220px"
        placeholder="如 13469117809"
        @update:model-value="(v) => emit('update:userid', v)"
      />
    </div>
    <div class="btn-row" style="margin-top: 10px">
      <el-button :loading="refreshingCreds" @click="emit('refresh-creds')">从浏览器刷新凭证</el-button>
    </div>
  </el-card>

  <!-- 表格 -->
  <el-card shadow="never" class="card">
    <template #header>
      <span>① 选择表格</span>
      <el-tag size="small" effect="light" class="pill">支持 .xlsx / .xls / .csv</el-tag>
    </template>
    <el-upload
      :ref="(el) => emit('update:uploadRef', el)"
      class="file-upload"
      drag
      action="#"
      :auto-upload="false"
      :limit="1"
      accept=".xlsx,.xls,.csv"
      :on-change="(f) => emit('file-change', f)"
      :on-exceed="(f) => emit('file-exceed', f)"
      :on-remove="() => emit('file-remove')"
    >
      <el-icon class="el-icon--upload"><upload-filled /></el-icon>
      <div class="el-upload__text">把表格文件拖到这里，或 <em>点击选择文件</em></div>
      <template #tip>
        <div class="el-upload__tip">表头必须包含：<b>视频路径</b>、<b>视频说明</b>、<b>商品编码</b>。</div>
      </template>
    </el-upload>

    <div class="btn-row">
      <el-button type="primary" @click="emit('parse')">解析表格</el-button>
      <el-button @click="emit('download-template')">下载 xlsx 模板</el-button>
    </div>

    <div v-if="rows.length" class="preview">
      <el-table :data="rows" size="small" max-height="320" border>
        <el-table-column type="index" label="#" width="50" />
        <el-table-column prop="path" label="视频路径" min-width="200" show-overflow-tooltip />
        <el-table-column prop="caption" label="视频说明" min-width="140" show-overflow-tooltip />
        <el-table-column prop="product" label="商品编码" min-width="90" />
        <el-table-column label="状态" width="150">
          <template #default="{ row }">
            <el-tag v-if="row.error" type="danger" size="small" :title="row.error">{{ row.error }}</el-tag>
            <el-tag v-else-if="row.status" :type="statusTag(row.status)" size="small">{{ statusText(row.status) }}</el-tag>
          </template>
        </el-table-column>
      </el-table>
    </div>
  </el-card>
</template>

<style scoped>
.pill { margin-left: var(--sp-2); }
.file-upload { margin-top: var(--sp-1); }
.field-label { font-size: var(--fs-xs); color: var(--text-3); margin-right: var(--sp-2); }
.shop-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.shop-region-select { width: 170px; flex: none; }
.shop-select { flex: 1 1 320px; min-width: 280px; }
.opt-region {
  display: inline-block;
  min-width: 82px;
  margin-right: var(--sp-2);
  font-size: var(--fs-xs);
  color: var(--text-3);
}
.opt-label { font-size: var(--fs-sm); }
/* 被国家/关键词筛掉的选项仍要渲染（保住已选标签的名称），只是在下拉里隐藏 */
.opt-filtered-out { display: none; }
.shop-empty-state {
  margin-top: var(--sp-1);
  padding: 10px var(--sp-3);
  border: 1px dashed var(--border);
  border-radius: var(--radius-sm);
  background: var(--surface-2);
}
.shop-empty-tip { margin-bottom: var(--sp-2); font-size: var(--fs-xs); color: var(--text-2); }
.shop-empty-state a { font-size: var(--fs-sm); color: var(--el-color-primary); text-decoration: none; }
.shop-empty-state a:hover { text-decoration: underline; }
.btn-row { display: flex; gap: var(--sp-3); margin-top: 6px; flex-wrap: wrap; align-items: center; }
.preview { margin-top: var(--sp-3); }
</style>
