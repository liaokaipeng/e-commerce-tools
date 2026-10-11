<!-- Shopee 获取退单仓库 · 页面编排：选店铺（开放平台已授权）→ 上传表格（Return ID / Order ID 两列）
     → SSE 批量调 get_return_detail 取 whs_id → 导出「Order ID 列后插入退单仓库ID」的新表格。
     表格解析与列语义见 useReturnTable.js；批量执行复用 composables/useBatchJob.js。 -->
<script setup>
import { ref, computed, onMounted } from 'vue';
import { ElMessage } from 'element-plus';
import LogPanel from '../components/LogPanel.vue';
import { useLog } from '../composables/useLog.js';
import { useBatchJob } from '../composables/useBatchJob.js';
import { downloadAoaXlsx } from '../utils/xlsx.js';
import { readTable, buildRows, buildExportAoa } from './useReturnTable.js';

// ---------- ① 店铺（开放平台已授权店铺，单选；与监控/技能同源，不受「重点店铺」筛选影响） ----------
const shops = ref([]);
const shopsLoading = ref(false);
const appConfigured = ref(true);
const shopId = ref('');

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

// ---------- ② 表格（SheetJS 前端解析；表头需含 Return ID 列与 Order ID 列） ----------
const table = ref(null); // { aoa, returnCol, orderCol, rows, skipped, fileName }

async function onFileChange(file) {
  const raw = (file && file.raw) || file;
  if (!raw) return;
  try {
    const buf = await raw.arrayBuffer();
    const parsed = readTable(buf, raw.name);
    const built = buildRows(parsed.aoa, parsed.returnCol);
    table.value = Object.assign({}, parsed, { rows: built.rows, skipped: built.skipped });
    results.value = [];
    finished.value = false;
    if (!built.rows.length) {
      ElMessage.warning('表格中没有有效的 Return ID 数据行');
    } else {
      const skipTip = built.skipped ? `，跳过 ${built.skipped} 行无 Return ID` : '';
      ElMessage.success(`已识别 Return ID 列与 Order ID 列，待查询 ${built.rows.length} 行${skipTip}`);
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
      results.value.push({ rowIndex: ev.rowIndex, returnId: ev.returnId, ok: ev.ok, whsId: ev.whsId, msg: ev.msg });
      ctx.progress.value.done += 1;
      if (!ev.ok) ctx.progress.value.fail += 1;
      return ev.ok
        ? { cls: 'ok', msg: `  ✓ 第 ${ev.rowIndex + 1} 行 ${ev.returnId} → ${ev.whsId}` }
        : { cls: 'err', msg: `  ✕ 第 ${ev.rowIndex + 1} 行 ${ev.returnId}：${ev.msg}` };
    },
    'summary': (ev) => ({ cls: ev.failed ? 'err' : 'ok', msg: `全部完成：成功 ${ev.success} 条，失败 ${ev.failed} 条，共 ${ev.cancelled} 条。` }),
    'cancelled': (ev) => ({ cls: 'err', msg: `已取消：已处理 ${ev.cancelled} 条，失败 ${ev.failed} 条。已完成的结果仍可导出。` }),
  },
  onFinish: () => { finished.value = true; },
});

const { running, progress, paused, pausing, jobId, togglePause, cancel } = job;

const runningTip = computed(() => (running.value
  ? `进行中：已处理 ${progress.value.done} / ${progress.value.total} 行（失败 ${progress.value.fail}）。`
  : '逐行调用开放平台 get_return_detail 获取退货仓库 ID（whs_id），只读不改动任何退单状态。'));

const canRun = computed(() => !!shopId.value && !!table.value && table.value.rows.length > 0 && !running.value);

async function onRun() {
  if (!shopId.value) { ElMessage.warning('请先选择店铺'); return; }
  if (!table.value || !table.value.rows.length) { ElMessage.warning('请先上传包含 Return ID 列的表格'); return; }
  results.value = [];
  finished.value = false;
  clearLog();
  log(`开始获取退单仓库：店铺 ${shopId.value}，共 ${table.value.rows.length} 行…`, 'info');
  await job.start(table.value.rows, { shopId: shopId.value, rows: table.value.rows });
}

// ---------- ④ 导出（Order ID 列后插入「退单仓库ID」新列） ----------
const okCount = computed(() => results.value.filter((r) => r.ok).length);

function onExport() {
  if (!table.value) return;
  const aoa = buildExportAoa(table.value.aoa, {
    returnCol: table.value.returnCol,
    orderCol: table.value.orderCol,
  }, results.value);
  downloadAoaXlsx(aoa, '退单仓库', `退单仓库ID_${shopId.value || 'shop'}.xlsx`);
  ElMessage.success('已导出：新列「退单仓库ID」已插在 Order ID 列后面');
}
</script>

<template>
  <div class="page">
    <div class="container">

      <el-card shadow="never" class="card">
        <template #header>
          <span>① 选择店铺</span>
        </template>
        <div class="shop-row">
          <el-select
            v-model="shopId"
            class="shop-select"
            :loading="shopsLoading"
            placeholder="选择已授权店铺"
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
            <div class="el-upload__tip">表头第 1 行必须包含 <b>Return ID</b> 列与 <b>Order ID</b> 列（也识别「退货ID / 退单编号 / 订单编号」等写法）。</div>
          </template>
        </el-upload>
        <div v-if="table" class="table-meta">
          文件：{{ table.fileName || '（未命名）' }} ｜ 待查询 {{ table.rows.length }} 行
          <span v-if="table.skipped">（跳过 {{ table.skipped }} 行无 Return ID）</span>
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
