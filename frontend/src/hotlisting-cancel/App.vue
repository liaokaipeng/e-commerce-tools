<script setup>
// Shopee 取消注册 Hot Listing：按店铺配置 SPU → 扫描已注册 SKU → 批量取消注册（可暂停 / 继续 / 取消）。
// 通用能力与「取消竞价」页共用：useShopeeSession / useLog / useBatchJob / PreviewTableCard。
import { ref, computed, onMounted } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import LoginCard from '../components/LoginCard.vue';
import StorePicker from '../components/StorePicker.vue';
import PreviewTableCard from '../components/PreviewTableCard.vue';
import { useShopeeSession } from '../composables/useShopeeSession.js';
import { useLog } from '../composables/useToolPage.js';
import { useBatchJob, usePreviewScan } from '../composables/useBatchJob.js';

const {
  status, refreshing, flash, refreshStatus,
  stores, storesLoading, storesEmptyTip, selected, selCount, clearAll, loadStores,
} = useShopeeSession('Cookie 已就绪，可直接选择店铺操作。');

const { logLines, log, clear: clearLog } = useLog();

// ---------- 各店铺 SPU 配置（持久化到后端，编辑后自动保存） ----------
// 每个店铺只配一个 SPU ID（单行输入框）
const spuMap = ref({});          // { shopId: spuId }
const saveState = ref('');       // '' | 'saving' | 'saved' | 'error'
let saveTimer = null;

function shopSpuId(shopId) {
  return String(spuMap.value[shopId] || '').trim();
}

// 已选店铺中已配置 SPU 的店铺数
const configuredSelCount = computed(() => [...selected].filter(id => shopSpuId(id) !== '').length);

async function loadSpuConfig() {
  try {
    const resp = await fetch('/api/hotlisting-cancel/spu-config');
    const j = await resp.json();
    if (j && j.ok) spuMap.value = j.map || {};
  } catch { /* 加载失败不阻塞页面，保存时会再提示 */ }
}

async function saveSpuConfig() {
  saveState.value = 'saving';
  try {
    const resp = await fetch('/api/hotlisting-cancel/spu-config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ map: spuMap.value }),
    });
    const j = await resp.json();
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
  if (configuredSelCount.value === 0) { ElMessage.warning('所选店铺均未配置 SPU ID，请先在第 ③ 步为店铺填写并保存'); return; }
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
  if (configuredSelCount.value === 0) { ElMessage.warning('所选店铺均未配置 SPU ID，请先在第 ③ 步为店铺填写并保存'); return; }
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

      <el-card shadow="never" class="card">
        <template #header>
          <div class="card-header-row">
            <span>③ 各店铺 SPU ID 配置（自动保存）</span>
            <span class="save-state">
              <span v-if="saveState === 'saving'" class="sv-saving">保存中…</span>
              <span v-else-if="saveState === 'saved'" class="sv-ok">已保存 ✓</span>
              <span v-else-if="saveState === 'error'" class="sv-err">保存失败</span>
            </span>
          </div>
        </template>
        <div class="spu-tip">
          为每个店铺配置要取消注册的 SPU ID（卖家中心商品链接中的 spuId，形如 /portal/marketing/cmt-buy-box?spuId=<b>42555837160</b>，每个店铺一个）；
          修改后自动保存到本地，下次打开无需重填。
        </div>
        <div v-if="stores.length === 0" class="spu-empty">暂无店铺，请先在上方完成登录并获取店铺列表。</div>
        <div v-for="st in stores" :key="st.id" class="spu-row">
          <div class="spu-row-head">
            <span class="spu-name" :title="st.name">{{ st.name }}</span>
            <span class="spu-id">ID {{ st.id }}</span>
            <span class="spu-count" :class="{ ok: shopSpuId(st.id) !== '' }">
              {{ shopSpuId(st.id) !== '' ? '已配置' : '未配置' }}
            </span>
          </div>
          <el-input
            :model-value="spuMap[st.id] || ''"
            @update:model-value="v => { spuMap[st.id] = v; onSpuInput(); }"
            placeholder="如 42555837160"
            class="spu-input"
            clearable
          />
        </div>
        <div class="actions">
          <span class="sel-count">已选 {{ selCount }} 个店铺，其中 {{ configuredSelCount }} 个已配置 SPU</span>
        </div>
      </el-card>

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
.spu-tip { font-size: 13px; color: #666; margin-bottom: 10px; line-height: 1.7; }
.spu-input { font-family: Consolas, Menlo, monospace; }
.save-state { font-size: 12px; }
.sv-saving { color: #888; }
.sv-ok { color: #2e7d32; }
.sv-err { color: #c62828; }
.spu-empty { color: #999; font-size: 13px; padding: 6px 0; }
.spu-row { margin-bottom: 12px; }
.spu-row-head { display: flex; align-items: center; gap: 10px; margin-bottom: 4px; }
.spu-name { font-weight: 600; max-width: 320px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.spu-id { color: #999; font-size: 12px; }
.spu-count { color: #b26a00; font-size: 12px; margin-left: auto; }
.spu-count.ok { color: #2e7d32; }
/* 预览表格 / 展开行 / 状态色等共用样式在 styles/base.css */
</style>
