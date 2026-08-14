<script setup>
import { ref, reactive, computed, onMounted, onUnmounted } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { useLogScroll, readSSE } from '../composables/useToolPage.js';

// ---------- 登录状态 ----------
const status = reactive({ loggedIn: false, cookieCount: 0, savedAt: '', tip: '', checking: true });
const refreshing = ref(false);
const flash = ref(false);

async function refreshStatus(manual = false) {
  if (refreshing.value) return;
  refreshing.value = true;
  status.checking = true;
  try {
    const r = await fetch('/api/status');
    const s = await r.json();
    if (s.loggedIn) {
      status.loggedIn = true;
      status.cookieCount = s.cookieCount;
      const saved = s.savedAt ? `最近推送时间：${new Date(s.savedAt).toLocaleString()}。` : '';
      status.tip = `Cookie 已就绪，可直接选择店铺操作。${saved}如登录过期，请重新点扩展推送。`;
    } else {
      status.loggedIn = false;
      status.tip =
        '请先登录 seller.shopee.cn，再点击浏览器扩展 [KP工具合集助手] → [发送登录信息到本地工具]，然后点「刷新状态」。';
    }
  } catch {
    status.loggedIn = false;
    status.tip = '请确认本地服务已启动（双击 启动.bat），并刷新本页。';
  } finally {
    status.checking = false;
    refreshing.value = false;
    if (manual) {
      flash.value = false;
      flash.value = true;
    }
  }
}

// ---------- 店铺列表 ----------
const stores = ref([]);
const selected = reactive(new Set());

const groups = computed(() => {
  const cats = [...new Set(stores.value.map((s) => s.category))];
  return cats.map((cat) => ({
    category: cat,
    list: stores.value.filter((s) => s.category === cat),
  }));
});

const selCount = computed(() => selected.size);

function toggleStore(id, checked) {
  if (checked) selected.add(id);
  else selected.delete(id);
}

function toggleGroup(cat, checked) {
  const list = stores.value.filter((s) => s.category === cat);
  list.forEach((s) => {
    if (checked) selected.add(s.id);
    else selected.delete(s.id);
  });
}

function groupState(cat) {
  const list = stores.value.filter((s) => s.category === cat);
  const allChecked = list.length > 0 && list.every((s) => selected.has(s.id));
  const some = list.some((s) => selected.has(s.id));
  return { allChecked, some };
}

async function loadStores() {
  try {
    const r = await fetch('/api/stores');
    stores.value = await r.json();
  } catch {
    ElMessage.error('加载店铺失败，请确认服务已启动。');
  }
}

function clearAll() {
  selected.clear();
}

// ---------- 日志 ----------
const logLines = ref([]);
const { logEl } = useLogScroll(logLines);

function log(msg, cls) {
  const time = new Date().toLocaleTimeString();
  logLines.value.push({ time, msg, cls });
}

// ---------- 扫描（预览待改进竞价） ----------
const scanning = ref(false);
const previewShops = ref([]);
const totalBidCount = computed(() => previewShops.value.reduce((n, s) => n + (s.bidCount || 0), 0));
const previewDone = ref(false);

async function doScan() {
  if (selected.size === 0) {
    ElMessage.warning('请先选择至少一个店铺');
    return;
  }
  scanning.value = true;
  previewDone.value = false;
  previewShops.value = [];
  logLines.value = [];
  log('开始扫描选中的 ' + selected.size + ' 个店铺的「待改进」竞价…', 'info');
  try {
    const resp = await fetch('/api/bidding-cancel/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ shopIds: [...selected] }),
    });
    const j = await resp.json();
    if (!j || !j.shops) {
      log(j && j.msg ? j.msg : '扫描请求失败', 'err');
      return;
    }
    previewShops.value = j.shops;
    for (const s of j.shops) {
      if (s.ok) {
        log(`✓ ${s.name}（${s.shopId}）：待改进竞价 ${s.bidCount} 条（${s.itemCount} 个商品）`, 'ok');
      } else {
        log(`✕ ${s.name}（${s.shopId}）扫描失败：${s.msg}`, 'err');
      }
    }
    const total = j.shops.reduce((n, s) => n + (s.bidCount || 0), 0);
    log(`扫描完成：共发现 ${total} 条待改进竞价。`, total > 0 ? 'info' : 'ok');
    if (total === 0) {
      ElMessage.info('没有发现待改进竞价，无需撤销。');
    }
    previewDone.value = true;
  } catch (e) {
    log('扫描请求失败：' + e.message, 'err');
  } finally {
    scanning.value = false;
  }
}

// ---------- 撤销竞价 ----------
const cancelling = ref(false);

async function doCancel() {
  if (selected.size === 0) {
    ElMessage.warning('请先选择至少一个店铺');
    return;
  }
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
  cancelling.value = true;
  logLines.value = [];
  log('开始撤销，共 ' + selected.size + ' 个店铺…', 'info');
  try {
    const resp = await fetch('/api/bidding-cancel/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ shopIds: [...selected] }),
    });
    if (!resp.ok || !resp.body) {
      const err = await resp.json().catch(() => ({}));
      log(err.msg || err.message || '请求失败', 'err');
      return;
    }
    await readSSE(resp, (ev) => {
      if (ev.type === 'shop-start') {
        log(`▶ ${ev.name}（${ev.shopId}）开始撤销…`, 'info');
      } else if (ev.type === 'bid-start') {
        log(`  · 撤销 ${ev.itemName}${ev.modelName ? '（' + ev.modelName + '）' : ''}…`, 'info');
      } else if (ev.type === 'bid-done') {
        if (ev.ok) {
          log(`    ✓ ${ev.itemName} 撤销成功`, 'ok');
        } else {
          log(`    ✕ ${ev.itemName} 撤销失败：${ev.msg}`, 'err');
        }
      } else if (ev.type === 'shop-done') {
        if (ev.ok) {
          log(`✓ ${ev.name}（${ev.shopId}）完成：撤销 ${ev.cancelled} 条，失败 ${ev.failed} 条。`, ev.failed ? 'err' : 'ok');
        } else {
          log(`✕ ${ev.name}（${ev.shopId}）失败：${ev.msg}`, 'err');
        }
      } else if (ev.type === 'summary') {
        log(`全部完成：共撤销 ${ev.cancelled} 条，失败 ${ev.failed} 条（${ev.success}/${ev.total} 个店铺成功）。`, ev.failed ? 'err' : 'ok');
        previewDone.value = false; // 状态已变化，提示重新扫描
      } else if (ev.type === 'fatal') {
        log(ev.msg, 'err');
      }
    });
  } catch (e) {
    log('撤销请求失败：' + e.message, 'err');
  } finally {
    cancelling.value = false;
  }
}

let timer = null;
onMounted(() => {
  refreshStatus();
  loadStores();
  timer = setInterval(() => refreshStatus(), 15000);
});
onUnmounted(() => {
  if (timer) clearInterval(timer);
});
</script>

<template>
  <div class="page">
    <div class="container">

      <el-card shadow="never" class="card">
        <template #header>① 登录（Cookie）</template>
        <div class="status-bar" :class="{ flash }">
          <el-tag :type="status.checking ? 'info' : status.loggedIn ? 'success' : 'danger'" effect="light">
            <span class="dot" :class="status.loggedIn ? 'ok' : 'err'"></span>
            {{ status.checking ? '检查中…' : status.loggedIn ? `已登录（${status.cookieCount} 个 Cookie）` : '未登录' }}
          </el-tag>
          <span class="status-tip">{{ status.tip }}</span>
          <el-button size="small" :loading="refreshing" @click="refreshStatus(true)">刷新状态</el-button>
        </div>
      </el-card>

      <el-card shadow="never" class="card">
        <template #header>② 选择店铺</template>
        <div v-loading="stores.length === 0" class="store-box">
          <div v-for="g in groups" :key="g.category" class="cat-group">
            <div class="cat-head">
              <el-checkbox
                :model-value="groupState(g.category).allChecked"
                :indeterminate="!groupState(g.category).allChecked && groupState(g.category).some"
                @change="(v) => toggleGroup(g.category, v)"
              ></el-checkbox>
              <span>{{ g.category }}</span>
              <span class="cat-count">{{ g.list.length }} 个店铺</span>
            </div>
            <div class="store-grid">
              <label
                v-for="s in g.list"
                :key="s.id"
                class="store-item"
                :class="{ selected: selected.has(s.id) }"
              >
                <el-checkbox :model-value="selected.has(s.id)" @change="(v) => toggleStore(s.id, v)"></el-checkbox>
                <span class="store-meta">
                  <span class="store-name">{{ s.name }}</span><br />
                  <span class="store-id">ID: {{ s.id }}</span>
                </span>
              </label>
            </div>
          </div>
        </div>
      </el-card>

      <el-card shadow="never" class="card">
        <template #header>③ 扫描待改进竞价（预览）</template>
        <div class="actions">
          <el-button type="primary" :disabled="selCount === 0" :loading="scanning" @click="doScan">
            {{ scanning ? '扫描中…' : '扫描待改进竞价' }}
          </el-button>
          <el-button @click="clearAll">清空选择</el-button>
          <span class="sel-count">已选 {{ selCount }} 个店铺</span>
          <span v-if="previewDone" class="sel-count warn">待改进竞价共 {{ totalBidCount }} 条</span>
        </div>
        <el-table
          v-if="previewShops.length"
          :data="previewShops"
          size="small"
          border
          class="preview-table"
          row-key="shopId"
          :default-expand-all="false"
        >
          <el-table-column type="expand">
            <template #default="{ row }">
              <div v-if="row.items && row.items.length" class="expand-list">
                <div v-for="it in row.items" :key="it.bidId" class="expand-row">
                  <span class="e-name" :title="it.name">{{ it.name }}</span>
                  <span v-if="it.modelName" class="e-model">{{ it.modelName }}</span>
                  <span class="e-price">竞价价：{{ it.price }}</span>
                  <span v-if="it.suggestedPrice" class="e-suggest">建议：{{ it.suggestedPrice }}</span>
                </div>
              </div>
              <div v-else class="expand-empty">无待改进竞价</div>
            </template>
          </el-table-column>
          <el-table-column prop="name" label="店铺" min-width="150" />
          <el-table-column prop="shopId" label="店铺ID" width="120" />
          <el-table-column label="商品数" width="80" align="center">
            <template #default="{ row }">{{ row.itemCount }}</template>
          </el-table-column>
          <el-table-column label="待改进竞价" width="100" align="center">
            <template #default="{ row }">
              <span :class="row.ok && row.bidCount ? 'cnt-bad' : 'cnt-ok'">{{ row.bidCount }}</span>
            </template>
          </el-table-column>
          <el-table-column label="状态" width="90" align="center">
            <template #default="{ row }">
              <el-tag v-if="row.ok" type="success" size="small">成功</el-tag>
              <el-tag v-else type="danger" size="small">失败</el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="msg" label="备注" min-width="160" show-overflow-tooltip />
        </el-table>
      </el-card>

      <el-card shadow="never" class="card danger-card">
        <template #header>④ 撤销竞价（危险操作）</template>
        <div class="actions">
          <el-button type="danger" size="large" :disabled="selCount === 0" :loading="cancelling" @click="doCancel">
            {{ cancelling ? '撤销中…' : '撤销全部待改进竞价' }}
          </el-button>
          <span class="danger-tip">撤销后竞价立即失效，不可恢复！建议先执行第 ③ 步扫描确认。</span>
        </div>
        <div class="log-box">
          <div ref="logEl" class="log">
            <div v-for="(l, i) in logLines" :key="i" :class="l.cls">[{{ l.time }}] {{ l.msg }}</div>
            <div v-if="logLines.length === 0" class="log-empty">等待操作…</div>
          </div>
        </div>
      </el-card>
    </div>
  </div>
</template>

<style scoped>
.page {
  font-family: "Microsoft YaHei", "PingFang SC", -apple-system, "Segoe UI", sans-serif;
  background: #f4f6fb;
  color: #1f2330;
  min-height: 100vh;
  padding: 28px 20px 0;
  box-sizing: border-box;
}
.container { max-width: 900px; margin: 0 auto; padding-bottom: 60px; }
.card { margin-bottom: 18px; border-radius: 14px; }
.danger-card { border: 1px solid #ffd2cc; }
.status-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  padding: 4px;
}
.status-bar.flash { animation: flashBg 0.6s ease; }
@keyframes flashBg {
  0% { background: #fff8e1; }
  100% { background: transparent; }
}
.dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  margin-right: 6px;
}
.dot.ok { background: #2e7d32; }
.dot.err { background: #c62828; }
.status-tip { font-size: 13px; color: #666; flex: 1; min-width: 200px; }
.store-box { min-height: 120px; }
.cat-group { margin-bottom: 18px; }
.cat-head {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 8px;
  font-weight: 600;
  font-size: 14px;
}
.cat-count { color: #999; font-weight: 400; font-size: 12px; }
.store-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(230px, 1fr));
  gap: 8px;
}
.store-item {
  display: flex;
  align-items: center;
  gap: 8px;
  border: 1px solid #e5e5e5;
  border-radius: 8px;
  padding: 10px 12px;
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s;
}
.store-item:hover { border-color: #ee4d2d; }
.store-item.selected { border-color: #ee4d2d; background: #fff5f3; }
.store-meta { line-height: 1.35; min-width: 0; }
.store-name { font-size: 13px; font-weight: 600; }
.store-id { font-size: 12px; color: #999; }
.actions { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.sel-count { font-size: 13px; color: #666; }
.sel-count.warn { color: #d84315; font-weight: 600; }
.danger-tip { font-size: 13px; color: #c62828; flex: 1; min-width: 220px; }
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
.e-price { color: #555; white-space: nowrap; }
.e-suggest { color: #d84315; white-space: nowrap; }
.expand-empty { color: #999; padding: 8px; }
.cnt-bad { color: #c62828; font-weight: 700; }
.cnt-ok { color: #2e7d32; }
.log-box { margin-top: 14px; }
.log {
  background: #10131c;
  color: #c8e1ff;
  font-family: Consolas, "Courier New", monospace;
  border-radius: 10px;
  padding: 14px;
  font-size: 12.5px;
  line-height: 1.7;
  max-height: 320px;
  overflow-y: auto;
  white-space: pre-wrap;
  word-break: break-all;
}
.log .ok { color: #5fd08a; }
.log .err { color: #ff7b72; }
.log .info { color: #b8c0cc; }
.log-empty { color: #8a8a8a; }
</style>
