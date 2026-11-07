<!-- Shopee 获取退单仓库 · 页面编排：上传表格（退款单号 / 店铺 / 订单编号 / 站点，即「多客退款单」导出表的列）
     → 按店铺取退货仓清单并按站点筛选 → 导出「订单编号列后插入退单仓库ID / 退货仓库 / 退货仓库地址」的新表格。
     多店铺：店铺不在这里选，完全由表格「店铺」列（店名末尾的店铺ID）决定（须为开放平台已授权店铺）。
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

// ---------- ② 表格（SheetJS 前端解析；表头需含 退款单号 / 店铺 列） ----------
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
      ElMessage.warning('表格中没有有效的退款单号数据行');
    } else {
      const tips = [];
      if (built.skipped) tips.push(`跳过 ${built.skipped} 行无退款单号`);
      if (built.skippedNoShop) tips.push(`跳过 ${built.skippedNoShop} 行店铺列取不到店铺ID`);
      const skipTip = tips.length ? `，${tips.join('，')}` : '';
      const regionTip = parsed.regionCol >= 0 ? '含站点列' : '无站点列（按店铺区域自动判断）';
      ElMessage.success(`已识别 退款单号 / 店铺（含店铺ID）列（${regionTip}），待查询 ${built.rows.length} 行（${tableShopIds.value.length} 个店铺）${skipTip}`);
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

// 表中未授权 / 已失效的店铺ID（仅提示；这些店铺的行会被跳过，其余店铺照常执行）
const badShopIds = computed(() => tableShopIds.value.filter((id) => {
  const s = shopById.value.get(id);
  return !s || s.state === 're_auth';
}));

// ---------- ③ 执行（SSE 批量任务：按店铺取退货仓清单 → 站点筛选 → 必要时轨迹消歧） ----------
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
    'shop-warehouse': (ev) => {
      const names = (ev.candidates || []).map((w) => w.whsName || w.whsId).filter(Boolean);
      const scope = ev.region ? `${ev.region} 站点` : '全部站点';
      return {
        cls: 'info',
        msg: `  店铺 ${ev.shopId}：${scope}退货仓 ${names.length} 个${names.length ? `（${names.join('、')}）` : ''}`,
      };
    },
    'row-done': (ev, ctx) => {
      results.value.push({
        rowIndex: ev.rowIndex, returnId: ev.returnId, shopId: ev.shopId, ok: ev.ok,
        whsId: ev.whsId, whsName: ev.whsName, whsAddress: ev.whsAddress, source: ev.source, msg: ev.msg,
      });
      ctx.progress.value.done += 1;
      if (!ev.ok) ctx.progress.value.fail += 1;
      if (!ev.ok) return { cls: 'err', msg: `  ✕ 第 ${ev.rowIndex + 1} 行 ${ev.returnId}（店铺 ${ev.shopId}）：${ev.msg}` };
      // 兜底口径只有 whs_id（接口未给地址），日志里标出来，避免误以为是完整地址
      const hit = ev.whsName || ev.whsAddress || ev.whsId || '-';
      const tail = ev.source === 'detail' ? '（仅仓库ID，接口未返回地址）' : '';
      return { cls: 'ok', msg: `  ✓ 第 ${ev.rowIndex + 1} 行 ${ev.returnId}（店铺 ${ev.shopId}）→ ${hit}${tail}` };
    },
    'summary': (ev) => ({ cls: ev.failed ? 'err' : 'ok', msg: `全部完成：成功 ${ev.success} 条，失败 ${ev.failed} 条，共 ${ev.cancelled} 条。` }),
    'cancelled': (ev) => ({ cls: 'err', msg: `已取消：已处理 ${ev.cancelled} 条，失败 ${ev.failed} 条。已完成的结果仍可导出。` }),
  },
  onFinish: () => { finished.value = true; },
});

const { running, progress, paused, pausing, jobId, togglePause, cancel } = job;

const canRun = computed(() => !!table.value && table.value.rows.length > 0 && !running.value);

async function onRun() {
  if (!table.value || !table.value.rows.length) { ElMessage.warning('请先上传包含 退款单号 / 店铺 列的表格'); return; }
  results.value = [];
  finished.value = false;
  clearLog();
  log(`开始获取退单仓库：${tableShopIds.value.length} 个店铺、共 ${table.value.rows.length} 行…`, 'info');
  if (badShopIds.value.length) {
    log(`其中 ${badShopIds.value.length} 个店铺未授权或已失效，这些行会被跳过：${badShopIds.value.join('、')}`, 'info');
  }
  await job.start(table.value.rows, { rows: table.value.rows });
}

// ---------- ④ 导出（Order ID 列后插入「退单仓库ID / 退货仓库 / 退货仓库地址」三列） ----------
function onExport() {
  if (!table.value) return;
  const aoa = buildExportAoa(table.value.aoa, {
    returnCol: table.value.returnCol,
    orderCol: table.value.orderCol,
    shopCol: table.value.shopCol,
  }, results.value);
  downloadAoaXlsx(aoa, '退单仓库', '退单仓库地址.xlsx');
  ElMessage.success('已导出：新列「退单仓库ID / 退货仓库 / 退货仓库地址」已插在 Order ID 列后面');
}
</script>

<template>
  <div class="page">
    <div class="container">
      <PageHeader title="获取退单仓库" desc="直接上传「多客退款单」导出表，按店铺与站点取各店退货仓，写入完整仓库地址后导出" />

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
          tip="按表格「店铺」列（店名末尾的店铺ID）每店查询一次退货仓清单（get_warehouse_detail），按站点筛选；同站点有多个仓时再用退货物流轨迹（get_reverse_tracking_info）区分。只读不改动任何退单状态。"
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
            <el-table-column label="退货仓库" min-width="150" show-overflow-tooltip>
              <template #default="{ row }">
                <span v-if="row.ok">{{ row.whsName || '—' }}</span>
                <el-tag v-else type="danger" size="small" :title="row.msg">失败</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="退货仓库地址" min-width="260" show-overflow-tooltip>
              <template #default="{ row }">
                <span v-if="row.ok">{{ row.whsAddress || (row.whsId ? `仅仓库ID：${row.whsId}` : '—') }}</span>
                <span v-else class="fail-msg">{{ row.msg }}</span>
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
.fail-msg { color: var(--danger, #f56c6c); }
</style>
