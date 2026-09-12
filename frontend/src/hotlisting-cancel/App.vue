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
// 地区标签：与 StorePicker / 开放平台店铺表一致（'CN' → '中国', 'PH' → '菲律宾' …）
import { regionLabel } from '../region-utils.js';

const {
  status, refreshing, flash, refreshStatus,
  stores, storesLoading, storesEmptyTip, selected, clearAll, loadStores,
} = useShopeeSession('Cookie 已就绪，可直接选择店铺操作。');

const { logLines, log, clear: clearLog } = useLog();

// ---------- 各店铺 SPU 配置（持久化到后端，编辑后自动保存） ----------
// 每个店铺配一个 SPU ID。配置区只渲染「本次已勾选」的店铺：授权店铺可能上百个，
// 而每次真正要操作的只有几个，全量平铺会逼着用户长滚动找店。
// 关键约束：spuMap 始终保存**全量**配置（含未选店铺），只在渲染层过滤，否则选店铺会丢历史配置。
const spuMap = ref({});          // { shopId: spuId }
const saveState = ref('');       // '' | 'saving' | 'saved' | 'error'
let saveTimer = null;

function shopSpuId(shopId) {
  return String(spuMap.value[shopId] || '').trim();
}

// 已选店铺（顺序跟随店铺列表）→ 配置区只渲染这些行
const selectedStores = computed(() => stores.value.filter(s => selected.has(String(s.id))));

// 已选店铺中已配置 / 待填写 SPU 的店铺数
const configuredSelCount = computed(() => selectedStores.value.filter(s => shopSpuId(s.id) !== '').length);
const pendingCount = computed(() => selectedStores.value.length - configuredSelCount.value);

// 配置区内搜索 + 状态筛选（已选很多时用来快速定位）
const spuKeyword = ref('');
const spuFilter = ref('');       // '' | 'set' | 'unset'
const visibleSpuStores = computed(() => {
  const kw = spuKeyword.value.trim().toLowerCase();
  return selectedStores.value.filter((s) => {
    const has = shopSpuId(s.id) !== '';
    if (spuFilter.value === 'set' && !has) return false;
    if (spuFilter.value === 'unset' && has) return false;
    if (!kw) return true;
    return `${s.name || ''} ${s.id}`.toLowerCase().includes(kw);
  });
});

// 历史配置：spuMap 里有值、但本次未勾选的店铺（含已不在授权列表里的旧店铺）。
// 收进折叠区——既不干扰本次操作，也不会变成「看不见又删不掉」的幽灵配置。
const savedElsewhere = computed(() => {
  const known = new Map(stores.value.map(s => [String(s.id), String(s.name || '')]));
  const out = [];
  for (const [id, v] of Object.entries(spuMap.value)) {
    const text = String(v || '').trim();
    if (!text || selected.has(id)) continue;
    out.push({ id, spu: text, name: known.get(id) || '', inStores: known.has(id) });
  }
  // 仍能匹配到店铺名的排在前面
  return out.sort((a, b) => (a.inStores === b.inStores ? 0 : (a.inStores ? -1 : 1)));
});

function setSpu(shopId, value) {
  spuMap.value[shopId] = value;
  onSpuInput();
}

function clearSpu(shopId) {
  delete spuMap.value[shopId];
  onSpuInput();
}

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

// ---------- 批量导入 / 导出（店铺多时在 Excel 里维护清单，一次粘贴搞定） ----------
const importVisible = ref(false);
const importText = ref('');
const exportVisible = ref(false);
const exportText = ref('');
const exportCount = ref(0);

/**
 * 解析批量导入文本（纯函数）：每行一条「店铺标识 + SPU ID」。
 * 分隔符支持 Tab / 逗号 / 分号 / 竖线；若一个都没有，则把行尾的纯数字当 SPU、其余当店铺标识。
 * 店铺标识优先按店铺 ID 精确匹配，其次按店铺名匹配（忽略大小写与首尾空白）。
 * @returns {{ items: Array<{id,name,spu}>, unmatched: string[] }}
 */
function parseBulkSpuText(text, storeList) {
  const byId = new Map();
  const byName = new Map();
  for (const s of storeList) {
    byId.set(String(s.id), String(s.name || ''));
    const n = String(s.name || '').trim().toLowerCase();
    if (n) byName.set(n, String(s.id));
  }
  const items = [];
  const unmatched = [];
  const seen = new Set();
  for (const line of String(text || '').split(/\r?\n/)) {
    const raw = line.trim();
    if (!raw) continue;
    let left = '';
    let right = '';
    const parts = raw.split(/[\t,;，；|]+/).map(s => s.trim()).filter(Boolean);
    if (parts.length >= 2) {
      left = parts[0];
      right = parts[1];
    } else {
      const m = raw.match(/^(.*?)\s+(\d{5,20})$/); // 店名可能含空格，故只认行尾数字为 SPU
      if (!m) { unmatched.push(raw); continue; }
      left = m[1].trim();
      right = m[2];
    }
    if (!/^\d{5,20}$/.test(right)) { unmatched.push(raw); continue; }
    const id = byId.has(left) ? left : byName.get(left.toLowerCase());
    if (!id || seen.has(id)) { unmatched.push(raw); continue; } // 同一店铺只取首条
    seen.add(id);
    items.push({ id, name: byId.get(id) || '', spu: right });
  }
  return { items, unmatched };
}

const importParsed = computed(() => parseBulkSpuText(importText.value, stores.value));

function openImport() {
  importText.value = '';
  importVisible.value = true;
}

function applyImport() {
  const { items, unmatched } = importParsed.value;
  if (!items.length) { ElMessage.warning('没有解析出有效记录，请检查格式'); return; }
  const overwrite = items.filter(it => shopSpuId(it.id) !== '').length;
  for (const it of items) spuMap.value[it.id] = it.spu;
  importVisible.value = false;
  saveSpuConfig();
  const skip = unmatched.length ? `，忽略 ${unmatched.length} 行无法识别的内容` : '';
  ElMessage.success(`已导入 ${items.length} 条（覆盖 ${overwrite} 条）${skip}`);
}

function openExport() {
  const lines = [];
  for (const [id, v] of Object.entries(spuMap.value)) {
    const text = String(v || '').trim();
    if (!text) continue;
    const st = stores.value.find(s => String(s.id) === id);
    lines.push(`${id}\t${text}\t${st ? st.name : ''}`); // 店铺ID / SPU / 店铺名（可原样再导入）
  }
  exportCount.value = lines.length;
  exportText.value = lines.length ? lines.join('\n') : '（暂无已配置的店铺）';
  exportVisible.value = true;
}

async function copyExport() {
  try {
    await navigator.clipboard.writeText(exportText.value);
    ElMessage.success('已复制到剪贴板');
  } catch {
    ElMessage.warning('复制失败，请手动全选复制');
  }
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
              <el-button @click="openImport">批量导入</el-button>
              <el-button @click="openExport">导出</el-button>
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

      <!-- 批量导入：直接从 Excel 粘两列（店铺ID 或 店铺名 + SPU） -->
      <el-dialog v-model="importVisible" title="批量导入 SPU 配置" width="620px">
        <div class="dlg-tip">
          从 Excel 直接粘贴两列：<b>店铺ID（或店铺名）</b> + <b>SPU ID</b>，每行一条，用 Tab / 逗号分隔。例如
          <code>123456789&nbsp;&nbsp;42555837160</code> 或 <code>深圳3C数码旗舰店,42555837160</code>。
        </div>
        <el-input v-model="importText" type="textarea" :rows="10" placeholder="每行一条：店铺ID 或 店铺名 + SPU ID" />
        <div class="dlg-preview">
          <template v-if="importText.trim()">
            识别到 <b>{{ importParsed.items.length }}</b> 条有效记录<template v-if="importParsed.unmatched.length">，
            <span class="warn">{{ importParsed.unmatched.length }} 行无法识别</span></template>
            <div v-for="it in importParsed.items.slice(0, 5)" :key="it.id" class="dlg-item">
              {{ it.name || '（无名称）' }}（{{ it.id }}）→ {{ it.spu }}
            </div>
            <div v-if="importParsed.items.length > 5" class="dlg-item">…等共 {{ importParsed.items.length }} 条</div>
          </template>
        </div>
        <template #footer>
          <el-button @click="importVisible = false">取消</el-button>
          <el-button type="primary" :disabled="importParsed.items.length === 0" @click="applyImport">导入并保存</el-button>
        </template>
      </el-dialog>

      <!-- 导出：把当前全量配置输出成「店铺ID / SPU / 店铺名」，可粘回 Excel 或修改后再导入 -->
      <el-dialog v-model="exportVisible" title="导出当前 SPU 配置" width="620px">
        <div class="dlg-tip">共 {{ exportCount }} 个店铺有配置，可直接复制到 Excel 存档；改完再用「批量导入」贴回来。</div>
        <el-input v-model="exportText" type="textarea" :rows="10" readonly />
        <template #footer>
          <el-button @click="exportVisible = false">关闭</el-button>
          <el-button type="primary" @click="copyExport">复制到剪贴板</el-button>
        </template>
      </el-dialog>

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
/* 批量导入 / 导出弹窗 */
.dlg-tip { font-size: var(--fs-sm); color: var(--text-2); line-height: 1.8; margin-bottom: var(--sp-2); }
.dlg-tip code { font-family: var(--font-mono); background: var(--surface-2); padding: 1px 4px; border-radius: 3px; }
.dlg-preview { margin-top: var(--sp-2); min-height: 20px; font-size: var(--fs-xs); color: var(--text-3); line-height: 1.8; }
.dlg-preview .warn { color: var(--warning); }
.dlg-item { font-family: var(--font-mono); color: var(--text-2); }
/* 预览表格 / 展开行 / 状态色等共用样式在 styles/base.css */
</style>
