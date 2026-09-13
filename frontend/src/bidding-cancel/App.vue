<script setup>
// Shopee 取消竞价：扫描「待改进」竞价 + 批量撤销（可暂停 / 继续 / 取消）。
// 通用能力：登录/店铺（useShopeeSession）、日志（useLog）、预览扫描与批量任务（useBatchJob）、
// 预览表格卡片（PreviewTableCard）——与「取消注册 Hot Listing」页共用同一套实现。
import { ref, computed } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import LoginCard from '../components/LoginCard.vue';
import StorePicker from '../components/StorePicker.vue';
import PreviewTableCard from '../components/PreviewTableCard.vue';
import { useShopeeSession } from '../composables/useShopeeSession.js';
import { useLog } from '../composables/useLog.js';
import { useBatchJob } from '../composables/useBatchJob.js';
import { usePreviewScan } from '../composables/usePreviewScan.js';

const {
  status, refreshing, flash, refreshStatus,
  stores, storesLoading, storesEmptyTip, selected, selCount, clearAll, loadStores,
} = useShopeeSession('Cookie 已就绪，可直接选择店铺操作。');

const { logLines, log, clear: clearLog } = useLog();

// ---------- 扫描（预览待改进竞价） ----------
const scan = usePreviewScan({
  url: '/api/bidding-cancel/preview',
  log,
  // 店铺级结果 → 日志文案 + 可操作条数
  summarize: (s) => (s.ok
    ? { ok: true, count: s.bidCount, msg: `✓ ${s.name}（${s.shopId}）：待改进竞价 ${s.bidCount} 条（${s.itemCount} 个商品）` }
    : { ok: false, count: 0, msg: `✕ ${s.name}（${s.shopId}）扫描失败：${s.msg}` }),
});

const { scanning, shops: previewShops, done: previewDone, totalCount: totalBidCount, scan: doScan } = scan;

async function onScan() {
  if (selected.size === 0) { ElMessage.warning('请先选择至少一个店铺'); return; }
  clearLog();
  log(`开始扫描选中的 ${selected.size} 个店铺的「待改进」竞价…`, 'info');
  await doScan({ shopIds: [...selected] });
  if (totalBidCount.value === 0 && previewDone.value) ElMessage.info('没有发现待改进竞价，无需撤销。');
}

// ---------- 撤销竞价 ----------
const job = useBatchJob({
  runUrl: '/api/bidding-cancel/run',
  controlBase: '/api/bidding-cancel',
  log,
  rowKeyOf: (r) => String(r.shopId),
  onFinish: () => { previewDone.value = false; }, // 状态已变化，提示重新扫描
  overrides: {
    'shop-start': (ev) => ({ cls: 'info', msg: `▶ ${ev.name}（${ev.shopId}）开始撤销…` }),
    'bid-start': (ev) => ({ cls: 'info', msg: `  · 撤销 ${ev.itemName}${ev.modelName ? '（' + ev.modelName + '）' : ''}…` }),
    'bid-done': (ev) => ({
      cls: ev.ok ? 'ok' : 'err',
      msg: ev.ok ? `    ✓ ${ev.itemName} 撤销成功` : `    ✕ ${ev.itemName} 撤销失败：${ev.msg}`,
    }),
  },
});

const { running: cancelling, jobId: curJobId, paused, pausing, start, togglePause, cancel } = job;

const runningTip = computed(() => (cancelling.value
  ? `进行中：已处理 ${job.progress.value.done} 条（失败 ${job.progress.value.fail}）。`
  : '撤销后竞价立即失效，不可恢复！建议先执行第 ③ 步扫描确认。'));

async function doCancel() {
  if (selected.size === 0) { ElMessage.warning('请先选择至少一个店铺'); return; }
  const hint = previewDone.value
    ? `上次扫描共发现 ${totalBidCount.value} 条待改进竞价。`
    : '尚未扫描，将实时拉取并撤销全部待改进竞价。';
  try {
    await ElMessageBox.confirm(
      `即将对选中的 ${selected.size} 个店铺撤销所有「待改进」竞价，撤销后不可恢复！\n${hint}\n\n确定要继续吗？`,
      '危险操作确认',
      { confirmButtonText: '继续撤销', cancelButtonText: '取消', type: 'warning', confirmButtonClass: 'el-button--danger' }
    );
  } catch {
    return; // 用户取消
  }
  clearLog();
  log(`开始撤销，共 ${selected.size} 个店铺…`, 'info');
  await start([], { shopIds: [...selected] });
}
</script>

<template>
  <div class="page">
    <div class="container">

      <LoginCard :status="status" :refreshing="refreshing" :flash="flash" @refresh="refreshStatus(true)" />

      <StorePicker :stores="stores" :selected="selected" :loading="storesLoading" :empty-tip="storesEmptyTip" :reload="loadStores" />

      <PreviewTableCard
        title="③ 扫描待改进竞价（预览）"
        :badge="previewDone ? `待改进竞价共 ${totalBidCount} 条` : ''"
        :rows="previewShops"
        :row-key-of="(r) => String(r.shopId)"
        count-label="待改进竞价"
        :count-of="(r) => r.bidCount"
        :running="scanning"
        :can-run="selCount > 0 && !scanning"
        action-text="扫描待改进竞价"
        running-text="扫描中…"
        danger-tip="扫描只读，不会改动任何竞价；确认条数后再执行下方撤销。"
        :cancellable="false"
        :log-lines="[]"
        @run="onScan"
      >
        <template #toolbar>
          <div class="actions">
            <span class="sel-count">已选 {{ selCount }} 个店铺</span>
            <el-button @click="clearAll">清空选择</el-button>
          </div>
        </template>
        <template #detail="{ row }">
          <div v-if="row.items && row.items.length" class="expand-list">
            <div v-for="it in row.items" :key="it.bidId" class="expand-row">
              <span class="e-name" :title="it.itemName">{{ it.itemName }}</span>
              <span v-if="it.modelName" class="e-model">{{ it.modelName }}</span>
              <span class="e-price">竞价价：{{ it.price }}</span>
              <span v-if="it.suggestedPrice" class="e-suggest">建议：{{ it.suggestedPrice }}</span>
            </div>
          </div>
          <div v-else class="expand-empty">无待改进竞价</div>
        </template>
      </PreviewTableCard>

      <PreviewTableCard
        title="④ 撤销竞价（危险操作）"
        :rows="previewShops"
        :row-key-of="(r) => String(r.shopId)"
        count-label="待改进竞价"
        :count-of="(r) => r.bidCount"
        :badge="cancelling ? `进度：已处理 ${job.progress.value.done}` : ''"
        :running="cancelling"
        :can-run="selCount > 0"
        action-text="撤销全部待改进竞价"
        running-text="撤销中…"
        :job-id="curJobId"
        :paused="paused"
        :pausing="pausing"
        paused-tip="已暂停：不再发起撤销，点击「继续」恢复。"
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
/* 页面级/共用样式统一在 styles/base.css（.danger-card / .preview-table / .expand-* 等） */
</style>
