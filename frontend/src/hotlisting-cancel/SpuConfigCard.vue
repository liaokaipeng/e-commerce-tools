<!-- Shopee 取消注册 Hot Listing · ③ SPU 配置卡片：只渲染已选店铺，支持搜索/筛选、导入导出入口与历史配置折叠。
     配置读写与派生状态在 useSpuConfig.js，本组件只负责渲染并上抛导入/导出事件。 -->
<script setup>
import { regionLabel } from '../region-utils.js';

defineProps({
  stores: { type: Array, default: () => [] },
  saveState: { type: String, default: '' },
  selectedStores: { type: Array, default: () => [] },
  configuredSelCount: { type: Number, default: 0 },
  pendingCount: { type: Number, default: 0 },
  visibleSpuStores: { type: Array, default: () => [] },
  savedElsewhere: { type: Array, default: () => [] },
  spuMap: { type: Object, default: () => ({}) },
  shopSpuId: { type: Function, required: true },
  setSpu: { type: Function, required: true },
  clearSpu: { type: Function, required: true },
});

// 搜索关键词 / 状态筛选：状态本体仍归 useSpuConfig，这里通过 defineModel 双向绑定
const spuKeyword = defineModel('spuKeyword', { type: String, default: '' });
const spuFilter = defineModel('spuFilter', { type: String, default: '' });

const emit = defineEmits(['bulk-import', 'bulk-export']);
</script>

<template>
  <el-card shadow="never" class="card">
    <template #header>
      <div class="card-header-row">
        <span>③ 已选店铺的 SPU ID（自动保存）</span>
        <span class="save-state">
          <span v-if="saveState === 'saving'" class="sv-saving">保存中…</span>
          <span v-else-if="saveState === 'saved'" class="sv-ok">已保存 ✓</span>
          <span v-else-if="saveState === 'error'" class="sv-err">保存失败</span>
        </span>
      </div>
    </template>
    <div class="spu-tip">
      每个店铺配一个 SPU ID（卖家中心商品链接中的 spuId，形如 /portal/marketing/cmt-buy-box?spuId=<b>42555837160</b>）；
      修改后自动保存，下次打开无需重填。此处只列出上方 ② 已勾选的店铺。
    </div>

    <div v-if="stores.length === 0" class="spu-empty">暂无店铺，请先在上方完成登录并获取店铺列表。</div>

    <template v-else>
      <div v-if="selectedStores.length === 0" class="spu-empty">
        请先在上方 ② 选择本次要操作的店铺（与「竞价导出 / 取消竞价」同一套店铺选择器）——这里只列出已选店铺；
        已保存的历史配置不会丢，见下方折叠区。
      </div>

      <template v-else>
        <div class="spu-toolbar">
          <el-input v-model="spuKeyword" class="spu-search" placeholder="搜索店铺名 / 店铺ID" clearable />
          <el-select v-model="spuFilter" class="spu-filter" clearable placeholder="全部状态">
            <el-option value="unset" label="仅未配置" />
            <el-option value="set" label="仅已配置" />
          </el-select>
          <el-button @click="emit('bulk-import')">批量导入</el-button>
          <el-button @click="emit('bulk-export')">导出</el-button>
        </div>
        <div class="spu-stat">
          已选 {{ selectedStores.length }} 个店铺，已配置 {{ configuredSelCount }} 个<template v-if="pendingCount">，
          <span class="warn">{{ pendingCount }} 个待填写</span></template>
        </div>

        <!-- 店铺清单与「开放平台」页的店铺表保持一致：表格 + 状态 tag + 操作列 -->
        <el-table
          :data="visibleSpuStores"
          size="small"
          max-height="360"
          class="spu-table"
          empty-text="没有匹配的已选店铺：换个关键词，或清空筛选条件试试"
        >
          <el-table-column label="店铺" min-width="200">
            <template #default="{ row }">
              <span class="spu-name" :title="row.name">{{ row.name }}</span>
              <span class="spu-id">ID {{ row.id }}</span>
            </template>
          </el-table-column>
          <el-table-column label="国家/地区" width="120">
            <template #default="{ row }">
              <span class="spu-region">{{ row.region ? regionLabel(row.region) : '地区未知' }}</span>
            </template>
          </el-table-column>
          <el-table-column label="SPU ID（每店一个）" min-width="230">
            <template #default="{ row }">
              <el-input
                :model-value="spuMap[row.id] || ''"
                @update:model-value="v => setSpu(row.id, v)"
                placeholder="如 42555837160"
                class="spu-input"
                clearable
              />
            </template>
          </el-table-column>
          <el-table-column label="状态" width="100">
            <template #default="{ row }">
              <el-tag :type="shopSpuId(row.id) !== '' ? 'success' : 'warning'" effect="light" size="small">
                {{ shopSpuId(row.id) !== '' ? '已配置' : '未配置' }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="80">
            <template #default="{ row }">
              <el-button v-if="shopSpuId(row.id) !== ''" link type="danger" size="small" @click="clearSpu(row.id)">清除</el-button>
            </template>
          </el-table-column>
        </el-table>
      </template>

      <!-- 已保存、但本次未勾选的店铺配置：折叠收起，避免干扰本次操作，也不让配置悄悄消失 -->
      <el-collapse v-if="savedElsewhere.length" class="spu-other">
        <el-collapse-item
          :title="`另有 ${savedElsewhere.length} 个店铺已保存 SPU 配置（本次未选，不影响本次操作）`"
          name="other"
        >
          <el-table :data="savedElsewhere" size="small" max-height="300">
            <el-table-column label="店铺" min-width="220">
              <template #default="{ row }">
                <span class="spu-name" :title="row.name">{{ row.name || '（不在当前店铺列表）' }}</span>
                <span class="spu-id">ID {{ row.id }}</span>
              </template>
            </el-table-column>
            <el-table-column label="SPU ID" min-width="230">
              <template #default="{ row }">
                <el-input
                  :model-value="spuMap[row.id] || ''"
                  @update:model-value="v => setSpu(row.id, v)"
                  class="spu-input"
                  size="small"
                />
              </template>
            </el-table-column>
            <el-table-column label="操作" width="80">
              <template #default="{ row }">
                <el-button link type="danger" size="small" @click="clearSpu(row.id)">清除</el-button>
              </template>
            </el-table-column>
          </el-table>
        </el-collapse-item>
      </el-collapse>
    </template>
  </el-card>
</template>

<style scoped>
.spu-tip { font-size: var(--fs-sm); color: var(--text-2); margin-bottom: 10px; line-height: 1.7; }
.spu-input { font-family: var(--font-mono); }
.save-state { font-size: var(--fs-xs); }
.sv-saving { color: var(--text-3); }
.sv-ok { color: var(--success); }
.sv-err { color: var(--danger); }
.spu-empty { color: var(--text-3); font-size: var(--fs-sm); padding: 6px 0; line-height: 1.7; }
/* 店铺表格：与「开放平台」页的店铺表同款呈现（表格 + 状态 tag + 操作列） */
.spu-table { width: 100%; }
.spu-name { font-weight: 600; color: var(--text-1); }
.spu-id { margin-left: var(--sp-2); color: var(--text-3); font-size: var(--fs-xs); }
.spu-region { color: var(--text-3); font-size: var(--fs-xs); }
/* 配置区工具条 / 搜索 / 状态提示 */
.spu-toolbar { display: flex; align-items: center; gap: var(--sp-2); flex-wrap: wrap; margin-bottom: var(--sp-2); }
.spu-search { width: 240px; }
.spu-filter { width: 132px; }
.spu-stat { font-size: var(--fs-xs); color: var(--text-3); margin-bottom: var(--sp-2); }
.spu-stat .warn { color: var(--warning); }
.spu-other { margin-top: var(--sp-4); }
</style>
