<!-- Shopee 获取退单仓库 · 页面编排：选店铺（开放平台已授权，多选但可选）→ 上传表格（Return ID 列必备，
     Order ID / 「店铺id」列可选）→ SSE 批量调 get_return_detail 取 whs_id（店铺按行取：表格店铺id 优先，选中唯一店铺兜底）
     → 导出「Order ID 列（无则 Return ID 列）后插入退单仓库ID」的新表格。
     表格解析与列语义见 useReturnTable.js；批量执行复用 composables/useBatchJob.js。 -->
<script setup>
import { ref, computed, watch, onMounted } from 'vue';
import { ElMessage } from 'element-plus';
import LogPanel from '../components/LogPanel.vue';
import { useLog } from '../composables/useLog.js';
import { useBatchJob } from '../composables/useBatchJob.js';
import { downloadAoaXlsx } from '../utils/xlsx.js';
import { readTable, buildRows, buildExportAoa } from './useReturnTable.js';

// ---------- ① 店铺（开放平台已授权店铺，多选但可选；与监控/技能同源，不受「重点店铺」筛选影响） ----------
// 语义：表格带「店铺id」列时可不选店铺（逐行按表格取值，支持多店铺混合表）；
//       只选 1 个店铺时，没有店铺id 的行由它兜底（与旧版单选行为一致）。
const shops = ref([]);
const shopsLoading = ref(false);
const appConfigured = ref(true);
const selectedShopIds = ref([]);

const shopStateTag = (s) => (s.state === 'valid' ? '有效' : s.state === 'expiring' ? '即将过期' : s.state === 're_auth' ? '需重新授权' : '已过期');

async function loadShops() {
  shopsLoading.value = true;
  try {
    const r = await fetch('/api/openapi/status');
    const j = await r.json();
    appConfigured.value = !!j.configured;
    shops.value = Array.isArray(j.shops) ? j.shops : [];
  } catch (e) {
    ElMessage.error('读取店铺列表失败：' + e.message);
  } finally {
    shopsLoading.value = false;
  }
}
onMounted(loadShops);

// ---------- ② 表格（SheetJS 前端解析；表头需含 Return ID 列与 Order ID 列，「店铺id」列可选） ----------
const parsed = ref(null); // { aoa, returnCol, orderCol, shopCol, fileName }

// 待查询行随「表格 + 店铺选择」实时重算（改店铺选择会改变没有店铺id 的行的归属）
const built = computed(() => (parsed.value
  ? buildRows(parsed.value.aoa, parsed.value.returnCol, parsed.value.shopCol, selectedShopIds.value)
  : { rows: [], skipped: 0, unresolved: 0, unresolvedRows: [] }));

// 本批涉及的店铺（行上的 shopId 去重）
const runShopIds = computed(() => [...new Set(built.value.rows.map((r) => r.shopId))]);

// 表格里的店铺id 不在已授权列表 / 授权已失效：不拦截执行（逐行失败也有明确原因），但提前提示排错
const badShopTip = computed(() => {
  if (!built.value.rows.length) return '';
  const stateOf = new Map(shops.value.map((s) => [String(s.shopId), s.state]));
  const missing = [];
  const invalid = [];
  for (const id of runShopIds.value) {
    const st = stateOf.get(id);
    if (st === undefined) missing.push(id);
    else if (st === 're_auth') invalid.push(id);
  }
  const brief = (ids) => (ids.length > 10 ? `${ids.slice(0, 10).join('、')} 等 ${ids.length} 个` : ids.join('、'));
  const parts = [];
  if (missing.length) parts.push(`${missing.length} 个店铺未授权：${brief(missing)}`);
  if (invalid.length) parts.push(`${invalid.length} 个店铺授权已失效：${brief(invalid)}`);
  return parts.join('；');
});

async function onFileChange(file) {
  const raw = (file && file.raw) || file;
  if (!raw) return;
  try {
    const buf = await raw.arrayBuffer();
    parsed.value = readTable(buf, raw.name);
    results.value = [];
    finished.value = false;
    const b = built.value;
    if (!b.rows.length) {
      ElMessage.warning(b.unresolved > 0
        ? '表格中的行都无法确定店铺：请选择 1 个店铺，或在表格第 1 行添加「店铺id」列'
        : '表格中没有有效的 Return ID 数据行');
    } else {
      const skipTip = b.skipped ? `，跳过 ${b.skipped} 行无 Return ID` : '';
      const unresTip = b.unresolved ? `，跳过 ${b.unresolved} 行无法确定店铺` : '';
      const cols = [parsed.value.shopCol >= 0 ? '店铺id' : '', parsed.value.orderCol >= 0 ? 'Order ID' : ''].filter(Boolean);
      const colsTip = cols.length ? `、${cols.join('、')} 列` : '（无 Order ID 列，结果列将插在 Return ID 列后）';
      ElMessage.success(`已识别 Return ID 列${colsTip}，待查询 ${b.rows.length} 行${skipTip}${unresTip}`);
    }
  } catch (e) {
    parsed.value = null;
    ElMessage.error(e.message);
  }
}

function onFileRemove() {
  parsed.value = null;
  results.value = [];
  finished.value = false;
}

// 改店铺选择会重算没有店铺id 的行的归属：旧结果作废（执行中不动，避免日志与结果对不上）
watch(selectedShopIds, () => {
  if (running.value) return;
  results.value = [];
  finished.value = false;
});

// ---------- ③ 执行（SSE 批量任务：逐行 get_return_detail → whs_id，店铺按行取） ----------
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
      results.value.push({ rowIndex: ev.rowIndex, shopId: ev.shopId, returnId: ev.returnId, ok: ev.ok, whsId: ev.whsId, msg: ev.msg });
      ctx.progress.value.done += 1;
      if (!ev.ok) ctx.progress.value.fail += 1;
      return ev.ok
        ? { cls: 'ok', msg: `  ✓ 第 ${ev.rowIndex + 1} 行（店铺 ${ev.shopId}）${ev.returnId} → ${ev.whsId}` }
        : { cls: 'err', msg: `  ✕ 第 ${ev.rowIndex + 1} 行（店铺 ${ev.shopId}）${ev.returnId}：${ev.msg}` };
    },
    'summary': (ev) => ({ cls: ev.failed ? 'err' : 'ok', msg: `全部完成：成功 ${ev.success} 条，失败 ${ev.failed} 条，共 ${ev.cancelled} 条。` }),
    'cancelled': (ev) => ({ cls: 'err', msg: `已取消：已处理 ${ev.cancelled} 条，失败 ${ev.failed} 条。已完成的结果仍可导出。` }),
  },
  onFinish: () => { finished.value = true; },
});

const { running, progress, paused, pausing, jobId, togglePause, cancel } = job;

const runningTip = computed(() => (running.value
  ? `进行中：已处理 ${progress.value.done} / ${progress.value.total} 行（失败 ${progress.value.fail}）。`
  : '逐行调用开放平台 get_return_detail 获取退货仓库 ID（whs_id），只读不改动任何退单状态；店铺按行确定（表格「店铺id」列优先，其次为选中的唯一店铺）。'));

const canRun = computed(() => built.value.rows.length > 0 && !running.value);

async function onRun() {
  if (!parsed.value) { ElMessage.warning('请先上传包含 Return ID 列的表格'); return; }
  // 表格没有「店铺id」列时，不选 / 多选都无法逐行定位店铺，必须恰好选 1 个兜底
  if (parsed.value.shopCol < 0 && selectedShopIds.value.length !== 1) {
    ElMessage.warning('表格中没有「店铺id」列：请选择 1 个店铺，或在表格第 1 行添加「店铺id」列');
    return;
  }
  const rows = built.value.rows;
  if (!rows.length) { ElMessage.warning('没有可查询的行：请检查表格是否包含 Return ID 列与店铺信息'); return; }
  results.value = [];
  finished.value = false;
  clearLog();
  const unresTip = built.value.unresolved ? `（跳过 ${built.value.unresolved} 行无法确定店铺）` : '';
  log(`开始获取退单仓库：共 ${rows.length} 行，涉及 ${runShopIds.value.length} 个店铺${unresTip}…`, 'info');
  await job.start(rows, { rows });
}

// ---------- ④ 导出（Order ID 列后插入「退单仓库ID」新列） ----------
const okCount = computed(() => results.value.filter((r) => r.ok).length);

function onExport() {
  if (!parsed.value) return;
  const aoa = buildExportAoa(parsed.value.aoa, {
    returnCol: parsed.value.returnCol,
    orderCol: parsed.value.orderCol,
  }, results.value, built.value.unresolvedRows);
  const shopIds = [...new Set(results.value.map((r) => r.shopId).filter(Boolean))];
  const tag = shopIds.length === 1 ? shopIds[0] : '多店铺';
  downloadAoaXlsx(aoa, '退单仓库', `退单仓库ID_${tag}.xlsx`);
  const atTip = parsed.value.orderCol >= 0 ? 'Order ID 列后面' : 'Return ID 列后面';
  ElMessage.success(`已导出：新列「退单仓库ID」已插在 ${atTip}`);
}
</script>

<template>
  <div class="page">
    <div class="container">

      <el-card shadow="never" class="card">
        <template #header>
          <span>① 选择店铺（可选）</span>
        </template>
        <div class="shop-row">
          <el-select
            v-model="selectedShopIds"
            class="shop-select"
            :loading="shopsLoading"
            placeholder="表格带「店铺id」列时可不选；也可选 1 个店铺兜底"
            multiple
            clearable
            collapse-tags
            collapse-tags-tooltip
            filterable
          >
            <el-option
              v-for="s in shops"
              :key="s.shopId"
              :value="String(s.shopId)"
              :label="`${s.shopId}（${shopStateTag(s)}）`"
              :disabled="s.state === 're_auth'"
            />
          </el-select>
          <el-button :loading="shopsLoading" @click="loadShops">刷新店铺</el-button>
        </div>
        <div class="shop-hint">表格带「店铺id」列时可不选店铺，逐行按表格取值（支持一表查多个店铺）；只选 1 个店铺时，表格里没有店铺id 的行由它兜底。</div>
        <div v-if="badShopTip" class="shop-warn">表格中的店铺不在可用授权列表：{{ badShopTip }}。这些行会逐行失败，请先到「开放平台」页处理。</div>
        <div v-if="!appConfigured" class="shop-empty-state">
          <div class="shop-empty-tip">尚未配置开放平台 App：请先到「开放平台」页录入 App 并完成店铺授权，再回来使用本工具。</div>
          <a href="/openapi/" target="_blank" rel="noopener">前往「开放平台」配置 / 授权 →</a>
        </div>
        <div v-else-if="!shops.length && !shopsLoading" class="shop-empty-state">
          <div class="shop-empty-tip">没有已授权店铺，请先到「开放平台」页授权。</div>
          <a href="/openapi/" target="_blank" rel="noopener">前往「开放平台」配置 / 授权 →</a>
        </div>
      </el-card>

      <el-card shadow="never" class="card">
        <template #header>
          <span>② 上传表格</span>
          <el-tag size="small" effect="light" class="pill">支持 .xlsx / .xls / .csv</el-tag>
        </template>
        <el-upload
          class="file-upload"
          drag
          action="#"
          :auto-upload="false"
          :limit="1"
          accept=".xlsx,.xls,.csv"
          :on-change="onFileChange"
          :on-exceed="(files) => onFileChange(files[0])"
          :on-remove="onFileRemove"
        >
          <el-icon class="el-icon--upload"><upload-filled /></el-icon>
          <div class="el-upload__text">把表格文件拖到这里，或 <em>点击选择文件</em></div>
          <template #tip>
            <div class="el-upload__tip">表头第 1 行必须包含 <b>Return ID</b> 列（查询只认 Return ID，Order ID 无法反查退单号）；<b>Order ID</b> 列可选（「订单编号 / 原订单号」等写法也能识别，没有时结果列插在 Return ID 列后），<b>店铺id</b> 列也可选（「shop_id / 店铺编号」等写法也能识别），带了即可一表查询多个店铺。</div>
          </template>
        </el-upload>
        <div v-if="parsed" class="table-meta">
          文件：{{ parsed.fileName || '（未命名）' }} ｜ 待查询 {{ built.rows.length }} 行，涉及 {{ runShopIds.length }} 个店铺
          <span v-if="built.skipped">（跳过 {{ built.skipped }} 行无 Return ID）</span>
          <span v-if="built.unresolved">（跳过 {{ built.unresolved }} 行无法确定店铺）</span>
        </div>
      </el-card>

      <el-card shadow="never" class="card">
        <template #header>
          <div class="card-header-row">
            <span>③ 获取退单仓库</span>
            <span v-if="jobId" class="job-id">任务 {{ jobId }}</span>
          </div>
        </template>
        <div class="actions">
          <el-button type="primary" :disabled="!canRun" :loading="running" @click="onRun">
            {{ running ? '获取中…' : '开始获取' }}
          </el-button>
          <el-button v-if="running" :loading="pausing" @click="togglePause">{{ paused ? '继续' : '暂停' }}</el-button>
          <el-button v-if="running" @click="cancel">取消</el-button>
          <el-button :disabled="!results.length" @click="onExport">导出结果表格</el-button>
        </div>
        <div class="hint exec-tip">{{ runningTip }}</div>
        <div class="log-box">
          <LogPanel :lines="logLines" height="260px" />
        </div>
        <div v-if="results.length" class="preview-table">
          <el-table :data="results.slice().reverse()" size="small" max-height="320" border>
            <el-table-column type="index" label="#" width="50" />
            <el-table-column label="表格行" width="80">
              <template #default="{ row }">{{ row.rowIndex + 1 }}</template>
            </el-table-column>
            <el-table-column prop="shopId" label="店铺ID" min-width="130" show-overflow-tooltip />
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
      </el-card>

    </div>
  </div>
</template>

<style scoped>
.shop-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.shop-select { flex: 1 1 320px; min-width: 280px; }
.shop-hint { margin-top: var(--sp-2); font-size: var(--fs-xs); color: var(--text-2); }
.shop-warn {
  margin-top: var(--sp-2);
  padding: 8px var(--sp-3);
  border: 1px dashed var(--el-color-warning);
  border-radius: var(--radius-sm);
  background: var(--surface-2);
  font-size: var(--fs-xs);
  color: var(--el-color-warning);
}
.pill { margin-left: var(--sp-2); }
.file-upload { margin-top: var(--sp-1); }
.table-meta { margin-top: var(--sp-3); font-size: var(--fs-sm); color: var(--text-2); }
.exec-tip { margin-top: var(--sp-3); }
.job-id { font-size: var(--fs-xs); color: var(--text-3); }
.whs { font-family: var(--font-mono); }
/* 未配置 App / 没有已授权店铺时的引导块：与 StorePicker / 视频页同一写法（scoped 不跨组件，各页各持一份） */
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
</style>
