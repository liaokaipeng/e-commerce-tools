<script setup>
import { ref, computed, onMounted } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import LoginCard from '../components/LoginCard.vue';
import StorePicker from '../components/StorePicker.vue';
import LogPanel from '../components/LogPanel.vue';
import { useShopeeSession } from '../composables/useShopeeSession.js';
import { useLog, readSSE } from '../composables/useToolPage.js';

// ---------- 登录状态 + 店铺列表（与竞价导出/取消竞价共用） ----------
const {
  status, refreshing, flash, refreshStatus,
  stores, selected, selCount, clearAll,
} = useShopeeSession('Cookie 已就绪，可直接选择店铺操作。');

// ---------- 日志 ----------
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
const scanning = ref(false);
const previewRows = ref([]);
const totalSkuCount = computed(() => previewRows.value.reduce((n, s) => n + (s.skuCount || 0), 0));
const previewDone = ref(false);

function buildPayload() {
  return { shopIds: [...selected], spuMap: { ...spuMap.value } };
}

async function doScan() {
  if (selected.size === 0) {
    ElMessage.warning('请先选择至少一个店铺');
    return;
  }
  if (configuredSelCount.value === 0) {
    ElMessage.warning('所选店铺均未配置 SPU ID，请先在第 ③ 步为店铺填写并保存');
    return;
  }
  scanning.value = true;
  previewDone.value = false;
  previewRows.value = [];
  clearLog();
  log(`开始扫描选中的 ${selected.size} 个店铺（其中 ${configuredSelCount.value} 个已配置 SPU）的「已注册」Hot Listing…`, 'info');
  try {
    const resp = await fetch('/api/hotlisting-cancel/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildPayload()),
    });
    const j = await resp.json();
    if (!j || !j.shops) {
      log(j && j.msg ? j.msg : '扫描请求失败', 'err');
      return;
    }
    // 展平为「店铺 × SPU」行，便于表格展开查看 SKU 明细
    for (const s of j.shops) {
      if (!s.ok) {
        previewRows.value.push({ shopId: s.shopId, name: s.name, spuId: '-', ok: false, msg: s.msg, skuCount: 0, items: [] });
        log(`✕ ${s.name}（${s.shopId}）扫描失败：${s.msg}`, 'err');
        continue;
      }
      for (const p of s.spus) {
        previewRows.value.push({ shopId: s.shopId, name: s.name, ...p });
        if (p.ok) {
          log(`✓ ${s.name}（${s.shopId}）SPU ${p.spuId}：已注册 SKU ${p.skuCount} 个`, 'ok');
        } else {
          log(`✕ ${s.name}（${s.shopId}）SPU ${p.spuId} 扫描失败：${p.msg}`, 'err');
        }
      }
    }
    const total = previewRows.value.reduce((n, s) => n + (s.skuCount || 0), 0);
    log(`扫描完成：共发现 ${total} 个已注册 SKU。`, total > 0 ? 'info' : 'ok');
    if (total === 0) {
      ElMessage.info('没有发现已注册的 Hot Listing SKU，无需取消。');
    }
    previewDone.value = true;
  } catch (e) {
    log('扫描请求失败：' + e.message, 'err');
  } finally {
    scanning.value = false;
  }
}

// ---------- 取消注册 ----------
const cancelling = ref(false);
const curJobId = ref('');   // 当前执行任务的 jobId（run 的 start 事件下发）
const paused = ref(false);  // 是否处于暂停状态
const pausing = ref(false); // 暂停/继续请求进行中

async function togglePause() {
  if (!curJobId.value || pausing.value) return;
  pausing.value = true;
  try {
    const next = !paused.value;
    const resp = await fetch(`/api/hotlisting-cancel/${next ? 'pause' : 'resume'}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jobId: curJobId.value }),
    });
    const j = await resp.json().catch(() => ({}));
    if (j && j.ok) {
      paused.value = next;
      log(next ? '⏸ 已暂停，点击「继续」恢复执行。' : '▶ 已恢复，继续取消注册…', 'info');
    } else {
      ElMessage.warning((j && j.msg) || '操作失败，任务可能已结束');
    }
  } catch (e) {
    ElMessage.error('操作失败：' + e.message);
  } finally {
    pausing.value = false;
  }
}

async function doCancel() {
  if (selected.size === 0) {
    ElMessage.warning('请先选择至少一个店铺');
    return;
  }
  if (configuredSelCount.value === 0) {
    ElMessage.warning('所选店铺均未配置 SPU ID，请先在第 ③ 步为店铺填写并保存');
    return;
  }
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
  cancelling.value = true;
  curJobId.value = '';
  paused.value = false;
  clearLog();
  log('开始取消注册，共 ' + selected.size + ' 个店铺…', 'info');
  try {
    const resp = await fetch('/api/hotlisting-cancel/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildPayload()),
    });
    if (!resp.ok || !resp.body) {
      const err = await resp.json().catch(() => ({}));
      log(err.msg || err.message || '请求失败', 'err');
      return;
    }
    await readSSE(resp, (ev) => {
      if (ev.type === 'start') {
        curJobId.value = ev.jobId;
      } else if (ev.type === 'shop-start') {
        log(`▶ ${ev.name}（${ev.shopId}）开始取消注册…`, 'info');
      } else if (ev.type === 'spu-done') {
        if (ev.ok) {
          log(`  ✓ SPU ${ev.spuId}：${ev.cancelled ? '取消注册 ' + ev.cancelled + ' 个 SKU' : (ev.msg || '无已注册 SKU')}`, 'ok');
        } else {
          log(`  ✕ SPU ${ev.spuId} 失败：${ev.msg}`, 'err');
        }
      } else if (ev.type === 'sku-start') {
        log(`  · 取消注册 ${ev.itemName}${ev.modelName ? '（' + ev.modelName + '）' : ''}…`, 'info');
      } else if (ev.type === 'sku-done') {
        if (ev.ok) {
          log(`    ✓ ${ev.itemName} 取消注册成功`, 'ok');
        } else {
          log(`    ✕ ${ev.itemName} 取消注册失败：${ev.msg}`, 'err');
        }
      } else if (ev.type === 'shop-done') {
        if (ev.ok) {
          log(`✓ ${ev.name}（${ev.shopId}）完成：取消注册 ${ev.cancelled} 个，失败 ${ev.failed} 个。`, ev.failed ? 'err' : 'ok');
        } else {
          log(`✕ ${ev.name}（${ev.shopId}）失败：${ev.msg}`, 'err');
        }
      } else if (ev.type === 'summary') {
        log(`全部完成：共取消注册 ${ev.cancelled} 个，失败 ${ev.failed} 个（${ev.success}/${ev.total} 个店铺成功）。`, ev.failed ? 'err' : 'ok');
        previewDone.value = false; // 状态已变化，提示重新扫描
      } else if (ev.type === 'fatal') {
        log(ev.msg, 'err');
      }
    });
  } catch (e) {
    log('取消注册请求失败：' + e.message, 'err');
  } finally {
    cancelling.value = false;
    curJobId.value = '';
    paused.value = false;
  }
}
</script>

<template>
  <div class="page">
    <div class="container">

      <LoginCard :status="status" :refreshing="refreshing" :flash="flash" @refresh="refreshStatus(true)" />

      <StorePicker :stores="stores" :selected="selected" />

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

      <el-card shadow="never" class="card">
        <template #header>④ 扫描已注册 Hot Listing（预览）</template>
        <div class="actions">
          <el-button type="primary" :disabled="selCount === 0 || configuredSelCount === 0" :loading="scanning" @click="doScan">
            {{ scanning ? '扫描中…' : '扫描已注册 SKU' }}
          </el-button>
          <el-button @click="clearAll">清空店铺选择</el-button>
          <span v-if="previewDone" class="sel-count warn">已注册 SKU 共 {{ totalSkuCount }} 个</span>
        </div>
        <el-table
          v-if="previewRows.length"
          :data="previewRows"
          size="small"
          border
          class="preview-table"
          row-key="shopId + '-' + spuId"
          :default-expand-all="false"
        >
          <el-table-column type="expand">
            <template #default="{ row }">
              <div v-if="row.items && row.items.length" class="expand-list">
                <div v-for="it in row.items" :key="it.rskuId" class="expand-row">
                  <span class="e-name" :title="it.itemName">{{ it.itemName }}</span>
                  <span v-if="it.modelName" class="e-model">{{ it.modelName }}</span>
                  <a v-if="it.previewLink" :href="it.previewLink" target="_blank" class="e-link">前台预览</a>
                </div>
              </div>
              <div v-else class="expand-empty">{{ row.ok ? '无已注册 SKU' : row.msg }}</div>
            </template>
          </el-table-column>
          <el-table-column prop="name" label="店铺" min-width="140" />
          <el-table-column prop="shopId" label="店铺ID" width="110" />
          <el-table-column prop="spuId" label="SPU ID" width="140" />
          <el-table-column label="已注册 SKU" width="100" align="center">
            <template #default="{ row }">
              <span :class="row.ok && row.skuCount ? 'cnt-bad' : 'cnt-ok'">{{ row.skuCount }}</span>
            </template>
          </el-table-column>
          <el-table-column label="状态" width="90" align="center">
            <template #default="{ row }">
              <el-tag v-if="row.ok" type="success" size="small">成功</el-tag>
              <el-tag v-else type="danger" size="small">失败</el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="msg" label="备注" min-width="140" show-overflow-tooltip />
        </el-table>
      </el-card>

      <el-card shadow="never" class="card danger-card">
        <template #header>⑤ 取消注册（危险操作）</template>
        <div class="actions">
          <el-button type="danger" size="large" :disabled="selCount === 0 || configuredSelCount === 0" :loading="cancelling && !paused" @click="doCancel">
            {{ cancelling ? '取消注册中…' : '取消注册全部已注册 SKU' }}
          </el-button>
          <el-button
            v-if="cancelling && curJobId"
            size="large"
            :type="paused ? 'success' : 'warning'"
            :loading="pausing"
            @click="togglePause"
          >
            {{ paused ? '继续' : '暂停' }}
          </el-button>
          <span v-if="cancelling && paused" class="paused-tip">已暂停：不再发起取消注册，点击「继续」恢复。</span>
          <span v-else class="danger-tip">取消后 Hot Listing 立即失效，需重新注册才能恢复！建议先执行第 ④ 步扫描确认。</span>
        </div>
        <div class="log-box">
          <LogPanel :lines="logLines" height="320px" />
        </div>
      </el-card>
    </div>
  </div>
</template>

<style scoped>
.danger-card { border: 1px solid #ffd2cc; }
.sel-count.warn { color: #d84315; font-weight: 600; }
.danger-tip { font-size: 13px; color: #c62828; flex: 1; min-width: 220px; }
.paused-tip { font-size: 13px; color: #b26a00; flex: 1; min-width: 220px; }
.spu-tip { font-size: 13px; color: #666; margin-bottom: 10px; line-height: 1.7; }
.spu-input { font-family: Consolas, Menlo, monospace; }
.card-header-row { display: flex; align-items: center; justify-content: space-between; }
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
.preview-table { margin-top: 14px; }
.expand-list { padding: 2px 10px 8px; }
.expand-row {
  display: flex;
  gap: 14px;
  align-items: center;
  padding: 6px 8px;
  border-bottom: 1px dashed #eee;
  font-size: 13px;
}
.e-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.e-model { color: #888; max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.e-link { color: #1e88e5; text-decoration: none; white-space: nowrap; }
.expand-empty { color: #999; padding: 8px; }
.cnt-bad { color: #c62828; font-weight: 700; }
.cnt-ok { color: #2e7d32; }
/* .log-box 为全局类（styles/base.css） */
</style>
