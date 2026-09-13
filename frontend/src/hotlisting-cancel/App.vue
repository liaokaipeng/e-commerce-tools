<!-- Shopee 取消注册 Hot Listing · 页面编排：组合 SPU 配置子系统（useSpuConfig / SpuConfigCard）、
     批量导入导出（SpuBulkDialogs / spu-text）与扫描、取消任务（usePreviewScan / useBatchJob）。 -->
<script setup>
// Shopee 取消注册 Hot Listing：按店铺配置 SPU → 扫描已注册 SKU → 批量取消注册（可暂停 / 继续 / 取消）。
// 本页只做编排：SPU 配置子系统见 useSpuConfig.js，导入/导出文本见 spu-text.js，
// 通用能力与「取消竞价」页共用：useShopeeSession / useLog / useBatchJob / PreviewTableCard。
import { ref, computed } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import LoginCard from '../components/LoginCard.vue';
import StorePicker from '../components/StorePicker.vue';
import PreviewTableCard from '../components/PreviewTableCard.vue';
import SpuConfigCard from './SpuConfigCard.vue';
import SpuBulkDialogs from './SpuBulkDialogs.vue';
import { useShopeeSession } from '../composables/useShopeeSession.js';
import { useLog } from '../composables/useLog.js';
import { useBatchJob } from '../composables/useBatchJob.js';
import { usePreviewScan } from '../composables/usePreviewScan.js';
import { useSpuConfig } from './useSpuConfig.js';

const {
  status, refreshing, flash, refreshStatus,
  stores, storesLoading, storesEmptyTip, selected, clearAll, loadStores,
} = useShopeeSession('Cookie 已就绪，可直接选择店铺操作。');

const { logLines, log, clear: clearLog } = useLog();

// ---------- 各店铺 SPU 配置（持久化 + 防抖自动保存 + 派生计数 + 搜索筛选 + 历史折叠） ----------
// 配置区只渲染「本次已勾选」的店铺；spuMap 始终保存全量配置（含未选店铺），只在渲染层过滤。
const {
  spuMap, saveState, shopSpuId, setSpu, clearSpu, saveSpuConfig,
  selectedStores, configuredSelCount, pendingCount,
  spuKeyword, spuFilter, visibleSpuStores, savedElsewhere,
} = useSpuConfig({ stores, selected });

// ---------- 批量导入 / 导出弹窗（打开由配置卡片工具条触发） ----------
const bulkDialogs = ref(null);
function openImport() { bulkDialogs.value?.openImport(); }
function openExport() { bulkDialogs.value?.openExport(); }

// 导入弹窗解析完成后回填：把全量配置写回 spuMap 并立即保存
function onApplyImport({ items, unmatched }) {
  const overwrite = items.filter(it => shopSpuId(it.id) !== '').length;
  for (const it of items) spuMap.value[it.id] = it.spu;
  saveSpuConfig();
  const skip = unmatched.length ? `，忽略 ${unmatched.length} 行无法识别的内容` : '';
  ElMessage.success(`已导入 ${items.length} 条（覆盖 ${overwrite} 条）${skip}`);
}

// ---------- 扫描（预览已注册 SKU） ----------
function buildPayload() {
  return { shopIds: [...selected], spuMap: { ...spuMap.value } };
}

// 已注册 SKU 数（SPU 级行）
const skuCountOf = (row) => row.skuCount || 0;

const scan = usePreviewScan({
  url: '/api/hotlisting-cancel/preview',
  log,
  summarize: (s) => {
    if (!s.ok) return { ok: false, count: 0, msg: `✕ ${s.name}（${s.shopId}）扫描失败：${s.msg}` };
    const n = (s.spus || []).reduce((a, p) => a + (p.skuCount || 0), 0);
    return { ok: true, count: n, msg: `✓ ${s.name}（${s.shopId}）：已注册 SKU ${n} 个（${(s.spus || []).length} 个 SPU）` };
  },
});

const { scanning, shops: previewShops, done: previewDone, totalCount: totalSkuCount, scan: doScan } = scan;

/** 预览表格行：把「店铺 → SPU」展平，便于逐 SPU 展开查看 SKU 明细 */
const previewRows = computed(() => {
  const out = [];
  for (const s of previewShops.value) {
    if (!s.ok) {
      out.push({ shopId: s.shopId, name: s.name, spuId: '-', ok: false, msg: s.msg, skuCount: 0, items: [], status: '' });
      continue;
    }
    for (const p of s.spus || []) {
      out.push({ shopId: s.shopId, name: s.name, spuId: p.spuId, ok: p.ok, msg: p.msg, skuCount: p.skuCount, items: p.items || [], status: '' });
    }
  }
  return out;
});

async function onScan() {
  if (selected.size === 0) { ElMessage.warning('请先选择至少一个店铺'); return; }
  if (configuredSelCount.value === 0) { ElMessage.warning('所选店铺均未配置 SPU ID，请先在上方 ③ 为已选店铺填写 SPU ID'); return; }
  clearLog();
  log(`开始扫描选中的 ${selected.size} 个店铺（其中 ${configuredSelCount.value} 个已配置 SPU）的「已注册」Hot Listing…`, 'info');
  await doScan(buildPayload());
  if (totalSkuCount.value === 0 && previewDone.value) ElMessage.info('没有发现已注册的 Hot Listing SKU，无需取消。');
}

// ---------- 取消注册 ----------
const job = useBatchJob({
  runUrl: '/api/hotlisting-cancel/run',
  controlBase: '/api/hotlisting-cancel',
  log,
  // 执行任务的 SSE 事件带 spuId；行键与预览行一致（店铺 + SPU）
  rowKeyOf: (r) => `${r.shopId}-${r.spuId}`,
  onFinish: () => { previewDone.value = false; },
  overrides: {
    'shop-start': (ev) => ({ cls: 'info', msg: `▶ ${ev.name}（${ev.shopId}）开始取消注册…` }),
    'spu-done': (ev) => (ev.ok
      ? { cls: 'ok', msg: `  ✓ SPU ${ev.spuId}：${ev.cancelled ? '取消注册 ' + ev.cancelled + ' 个 SKU' : (ev.msg || '无已注册 SKU')}` }
      : { cls: 'err', msg: `  ✕ SPU ${ev.spuId} 失败：${ev.msg}` }),
    'sku-start': (ev) => ({ cls: 'info', msg: `  · 取消注册 ${ev.itemName}${ev.modelName ? '（' + ev.modelName + '）' : ''}…` }),
    'sku-done': (ev) => ({
      cls: ev.ok ? 'ok' : 'err',
      msg: ev.ok ? `    ✓ ${ev.itemName} 取消注册成功` : `    ✕ ${ev.itemName} 取消注册失败：${ev.msg}`,
    }),
  },
});

const { running: cancelling, jobId: curJobId, paused, pausing, start, togglePause, cancel } = job;

const runningTip = computed(() => (cancelling.value
  ? `进行中：已处理 ${job.progress.value.done} 项（失败 ${job.progress.value.fail}）。`
  : '取消后 Hot Listing 立即失效，需重新注册才能恢复！建议先执行第 ④ 步扫描确认。'));

async function doCancel() {
  if (selected.size === 0) { ElMessage.warning('请先选择至少一个店铺'); return; }
  if (configuredSelCount.value === 0) { ElMessage.warning('所选店铺均未配置 SPU ID，请先在上方 ③ 为已选店铺填写 SPU ID'); return; }
  const hint = previewDone.value
    ? `上次扫描共发现 ${totalSkuCount.value} 个已注册 SKU。`
    : '尚未扫描，将实时拉取并取消全部已注册 SKU。';
  try {
    await ElMessageBox.confirm(
      `即将对选中 ${configuredSelCount.value} 个店铺（各 1 个 SPU）取消注册全部「已注册」Hot Listing SKU，取消后需重新注册才能恢复！\n${hint}\n\n确定要继续吗？`,
      '危险操作确认',
      { confirmButtonText: '继续取消注册', cancelButtonText: '取消', type: 'warning', confirmButtonClass: 'el-button--danger' }
    );
  } catch {
    return; // 用户取消
  }
  clearLog();
  log(`开始取消注册，共 ${configuredSelCount.value} 个店铺…`, 'info');
  await start(previewRows.value, buildPayload());
}
</script>

<template>
  <div class="page">
    <div class="container">

      <LoginCard :status="status" :refreshing="refreshing" :flash="flash" @refresh="refreshStatus(true)" />

      <StorePicker :stores="stores" :selected="selected" :loading="storesLoading" :empty-tip="storesEmptyTip" :reload="loadStores" />

      <SpuConfigCard
        v-model:spuKeyword="spuKeyword"
        v-model:spuFilter="spuFilter"
        :stores="stores"
        :save-state="saveState"
        :selected-stores="selectedStores"
        :configured-sel-count="configuredSelCount"
        :pending-count="pendingCount"
        :visible-spu-stores="visibleSpuStores"
        :saved-elsewhere="savedElsewhere"
        :spu-map="spuMap"
        :shop-spu-id="shopSpuId"
        :set-spu="setSpu"
        :clear-spu="clearSpu"
        @bulk-import="openImport"
        @bulk-export="openExport"
      />

      <SpuBulkDialogs
        ref="bulkDialogs"
        :stores="stores"
        :spu-map="spuMap"
        @apply="onApplyImport"
      />

      <PreviewTableCard
        title="④ 扫描已注册 Hot Listing（预览）"
        :badge="previewDone ? `已注册 SKU 共 ${totalSkuCount} 个` : ''"
        :rows="previewRows"
        :row-key-of="(r) => `${r.shopId}-${r.spuId}`"
        count-label="已注册 SKU"
        :count-of="skuCountOf"
        :running="scanning"
        :can-run="selected.size > 0 && configuredSelCount > 0 && !scanning"
        action-text="扫描已注册 SKU"
        running-text="扫描中…"
        danger-tip="扫描只读，不会改动任何注册状态；确认个数后再执行下方取消注册。"
        :cancellable="false"
        :log-lines="[]"
        @run="onScan"
      >
        <template #toolbar>
          <div class="actions">
            <el-button @click="clearAll">清空店铺选择</el-button>
          </div>
        </template>
        <template #columns>
          <el-table-column prop="spuId" label="SPU ID" width="140" />
        </template>
        <template #detail="{ row }">
          <div v-if="row.items && row.items.length" class="expand-list">
            <div v-for="it in row.items" :key="it.rskuId" class="expand-row">
              <span class="e-name" :title="it.itemName">{{ it.itemName }}</span>
              <span v-if="it.modelName" class="e-model">{{ it.modelName }}</span>
              <a v-if="it.previewLink" :href="it.previewLink" target="_blank" class="e-link">前台预览</a>
            </div>
          </div>
          <div v-else class="expand-empty">{{ row.ok ? '无已注册 SKU' : row.msg }}</div>
        </template>
      </PreviewTableCard>

      <PreviewTableCard
        title="⑤ 取消注册（危险操作）"
        :rows="previewRows"
        :row-key-of="(r) => `${r.shopId}-${r.spuId}`"
        count-label="已注册 SKU"
        :count-of="skuCountOf"
        :badge="cancelling ? `进度：已处理 ${job.progress.value.done} 项` : ''"
        :running="cancelling"
        :can-run="selected.size > 0 && configuredSelCount > 0"
        action-text="取消注册全部已注册 SKU"
        running-text="取消注册中…"
        :job-id="curJobId"
        :paused="paused"
        :pausing="pausing"
        paused-tip="已暂停：不再发起取消注册，点击「继续」恢复。"
        :danger-tip="runningTip"
        :log-lines="logLines"
        @run="doCancel"
        @pause="togglePause"
        @cancel="cancel"
      />
    </div>
  </div>
</template>

<style scoped>
/* 页面级/共用样式统一在 styles/base.css（.danger-card / .preview-table / .expand-* 等）；
   SPU 配置卡片与导入导出弹窗的样式分别在 SpuConfigCard.vue / SpuBulkDialogs.vue 内。 */
</style>
