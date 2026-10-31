<!-- Shopee 获取退单仓库 · 页面编排：上传表格（Return ID / Order ID / 店铺ID 三列）→ 按行取店铺ID
     → SSE 批量调 get_return_detail 取 whs_id → 导出「Order ID 列后插入退单仓库ID」的新表格。
     多店铺：店铺不在这里选，完全由表格「店铺ID」列决定（须为开放平台已授权店铺）。
     展示拆 ShopWallCard（① 授权店铺）/ UploadCard（② 上传表格）；表格解析与列语义见 useReturnTable.js；
     批量执行复用 composables/useBatchJob.js（执行区含可视化进度条）。 -->
<script setup>
import { ref, computed, onMounted } from 'vue';
import { ElMessage } from 'element-plus';
import PageHeader from '../components/PageHeader.vue';
import StepCard from '../components/StepCard.vue';
import RunControl from '../components/RunControl.vue';
import LogPanel from '../components/LogPanel.vue';
import ShopWallCard from './ShopWallCard.vue';
import UploadCard from './UploadCard.vue';
import { useLog } from '../composables/useLog.js';
import { useBatchJob } from '../composables/useBatchJob.js';
import { downloadAoaXlsx } from '../utils/xlsx.js';
import { readTable, buildRows, buildExportAoa } from './useReturnTable.js';
import { getJsonResult } from '../composables/api.js';

// ---------- ① 授权店铺（只读校验用：表格里的店铺ID必须都能对上，不在这里选店） ----------
const shops = ref([]);
const shopsLoading = ref(false);
const appConfigured = ref(true);

async function loadShops() {
  shopsLoading.value = true;
  try {
    const j = await getJsonResult('/api/openapi/status');
    appConfigured.value = !!j.configured;
    shops.value = Array.isArray(j.shops) ? j.shops : [];
  } catch (e) {
    ElMessage.error('读取店铺列表失败：' + e.message);
  } finally {
    shopsLoading.value = false;
  }
}
onMounted(loadShops);

const shopById = computed(() => {
  const m = new Map();
  for (const s of shops.value) m.set(String(s.shopId), s);
  return m;
});

// ---------- ② 表格（SheetJS 前端解析；表头需含 Return ID / Order ID / 店铺ID 列） ----------
const table = ref(null); // { aoa, returnCol, orderCol, shopCol, rows, skipped, skippedNoShop, fileName }

async function onFileChange(file) {
  const raw = (file && file.raw) || file;
  if (!raw) return;
  try {
    const buf = await raw.arrayBuffer();
    const parsed = readTable(buf, raw.name);
    const built = buildRows(parsed.aoa, parsed);
    table.value = Object.assign({}, parsed, { rows: built.rows, skipped: built.skipped, skippedNoShop: built.skippedNoShop });
    results.value = [];
    finished.value = false;
    if (!built.rows.length) {
      ElMessage.warning('表格中没有有效的 Return ID 数据行');
    } else {
      const tips = [];
      if (built.skipped) tips.push(`跳过 ${built.skipped} 行无 Return ID`);
      if (built.skippedNoShop) tips.push(`跳过 ${built.skippedNoShop} 行无店铺ID`);
      const skipTip = tips.length ? `，${tips.join('，')}` : '';
      ElMessage.success(`已识别 Return ID / Order ID / 店铺ID 列，待查询 ${built.rows.length} 行（${tableShopIds.value.length} 个店铺）${skipTip}`);
    }
  } catch (e) {
    table.value = null;
    ElMessage.error(e.message);
  }
}

function onFileRemove() {
  table.value = null;
  results.value = [];
  finished.value = false;
}

// 表格涉及的店铺ID（去重，按出现顺序）
const tableShopIds = computed(() => {
  if (!table.value) return [];
  return Array.from(new Set(table.value.rows.map((r) => r.shopId)));
});

// 表中未授权 / 已失效的店铺ID（有则禁止执行，避免整批逐行报「店铺尚未授权」）
const badShopIds = computed(() => tableShopIds.value.filter((id) => {
  const s = shopById.value.get(id);
  return !s || s.state === 're_auth';
}));

// ---------- ③ 执行（SSE 批量任务：逐行 get_return_detail → whs_id） ----------
const { logLines, log, clear: clearLog } = useLog();
const results = ref([]);
const finished = ref(false);

const job = useBatchJob({
  runUrl: '/api/return-whs/run',
  controlBase: '/api/return-whs',
  log,
  // 行键用 AOA 行下标；SSE 事件的 rowIndex 与预览行、导出写回三处对齐
  rowKeyOf: (r) => String(r.rowIndex),
  overrides: {
    'row-done': (ev, ctx) => {
      results.value.push({ rowIndex: ev.rowIndex, returnId: ev.returnId, shopId: ev.shopId, ok: ev.ok, whsId: ev.whsId, msg: ev.msg });
      ctx.progress.value.done += 1;
      if (!ev.ok) ctx.progress.value.fail += 1;
      return ev.ok
        ? { cls: 'ok', msg: `  ✓ 第 ${ev.rowIndex + 1} 行 ${ev.returnId}（店铺 ${ev.shopId}）→ ${ev.whsId}` }
        : { cls: 'err', msg: `  ✕ 第 ${ev.rowIndex + 1} 行 ${ev.returnId}（店铺 ${ev.shopId}）：${ev.msg}` };
    },
    'summary': (ev) => ({ cls: ev.failed ? 'err' : 'ok', msg: `全部完成：成功 ${ev.success} 条，失败 ${ev.failed} 条，共 ${ev.cancelled} 条。` }),
    'cancelled': (ev) => ({ cls: 'err', msg: `已取消：已处理 ${ev.cancelled} 条，失败 ${ev.failed} 条。已完成的结果仍可导出。` }),
  },
  onFinish: () => { finished.value = true; },
});

const { running, progress, paused, pausing, jobId, togglePause, cancel } = job;

const canRun = computed(() => !!table.value && table.value.rows.length > 0
  && badShopIds.value.length === 0 && !running.value);

async function onRun() {
  if (!table.value || !table.value.rows.length) { ElMessage.warning('请先上传包含 Return ID / 店铺ID 列的表格'); return; }
  if (badShopIds.value.length) { ElMessage.warning(`表格中有未授权或已失效的店铺ID：${badShopIds.value.join('、')}`); return; }
  results.value = [];
  finished.value = false;
  clearLog();
  log(`开始获取退单仓库：${tableShopIds.value.length} 个店铺、共 ${table.value.rows.length} 行…`, 'info');
  await job.start(table.value.rows, { rows: table.value.rows });
}

// ---------- ④ 导出（Order ID 列后插入「退单仓库ID」新列） ----------
function onExport() {
  if (!table.value) return;
  const aoa = buildExportAoa(table.value.aoa, {
    returnCol: table.value.returnCol,
    orderCol: table.value.orderCol,
    shopCol: table.value.shopCol,
  }, results.value);
  downloadAoaXlsx(aoa, '退单仓库', '退单仓库ID.xlsx');
  ElMessage.success('已导出：新列「退单仓库ID」已插在 Order ID 列后面');
}
</script>

<template>
  <div class="page">
    <div class="container">
      <PageHeader title="获取退单仓库" desc="按表格逐行查询 Return ID 对应的退货仓库 ID（whs_id），结果写回表格导出" />

      <ShopWallCard
        :shops="shops"
        :shops-loading="shopsLoading"
        :app-configured="appConfigured"
        :reload="loadShops"
      />

      <UploadCard
        :table="table"
        :table-shop-ids="tableShopIds"
        :bad-shop-ids="badShopIds"
        @file-change="onFileChange"
        @file-remove="onFileRemove"
      />

      <StepCard :index="3" title="获取退单仓库">
        <template #extra>
          <span v-if="jobId" class="job-id">任务 {{ jobId }}</span>
        </template>
        <RunControl
          action-text="开始获取"
          running-text="获取中…"
          :running="running"
          :can-run="canRun"
          :job-id="jobId"
          :paused="paused"
          :pausing="pausing"
          :progress="running ? progress : null"
          tip="逐行按表格「店铺ID」列调用开放平台 get_return_detail 获取退货仓库 ID（whs_id），只读不改动任何退单状态。"
          @run="onRun"
          @pause="togglePause"
          @cancel="cancel"
        >
          <template #extra-actions>
            <el-button size="large" :disabled="!results.length" @click="onExport">导出结果表格</el-button>
          </template>
        </RunControl>
        <div class="log-box">
          <LogPanel :lines="logLines" />
        </div>
        <div v-if="results.length" class="preview-table">
          <el-table :data="results.slice().reverse()" size="small" max-height="320" border>
            <el-table-column type="index" label="#" width="50" />
            <el-table-column label="表格行" width="80">
              <template #default="{ row }">{{ row.rowIndex + 1 }}</template>
            </el-table-column>
            <el-table-column prop="shopId" label="店铺ID" width="130" show-overflow-tooltip />
            <el-table-column prop="returnId" label="Return ID" min-width="160" show-overflow-tooltip />
            <el-table-column label="退单仓库ID" min-width="140">
              <template #default="{ row }">
                <span v-if="row.ok" class="whs">{{ row.whsId }}</span>
                <el-tag v-else type="danger" size="small" :title="row.msg">失败</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="状态" width="90">
              <template #default="{ row }">
                <el-tag :type="row.ok ? 'success' : 'danger'" size="small">{{ row.ok ? '成功' : '失败' }}</el-tag>
              </template>
            </el-table-column>
          </el-table>
        </div>
      </StepCard>
    </div>
  </div>
</template>

<style scoped>
.job-id { font-size: var(--fs-xs); color: var(--text-3); }
.whs { font-family: var(--font-mono); }
</style>
