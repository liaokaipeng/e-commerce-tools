<script setup>
import { ref, reactive, computed, watch, nextTick, onMounted, onUnmounted } from 'vue';
import { ElMessage } from 'element-plus';
import DirPicker from '../components/DirPicker.vue';

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
      status.tip = `Cookie 已就绪，可直接选择店铺导出。${saved}如登录过期，请重新点扩展推送。`;
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

// ---------- 保存位置 ----------
const dir = ref('');
const hasDefault = ref(false);
const dirPickerVisible = ref(false);

async function loadDirSettings() {
  try {
    const r = await fetch('/api/settings');
    const s = await r.json();
    const d = s.defaults && s.defaults.bidding;
    if (d) {
      dir.value = d;
      hasDefault.value = true;
    }
  } catch {}
}

async function setDefaultDir(d) {
  try {
    const r = await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tool: 'bidding', dir: d }),
    });
    const res = await r.json();
    if (res.ok) {
      hasDefault.value = true;
      log('已设为默认目录：' + d, 'ok');
      return true;
    }
    log('设置默认目录失败：' + (res.message || '未知错误'), 'err');
    return false;
  } catch {
    log('设置默认目录失败：连接服务失败', 'err');
    return false;
  }
}

async function openDir() {
  const d = dir.value.trim();
  if (!d) {
    ElMessage.warning('请先填写保存目录');
    return;
  }
  try {
    const r = await fetch('/api/open-dir', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dir: d }),
    });
    const res = await r.json();
    if (!res.ok) log('无法打开目录：' + res.message, 'err');
  } catch {
    log('无法打开目录：连接服务失败', 'err');
  }
}

// ---------- 日志 ----------
const logLines = ref([]);
const logEl = ref(null);

function log(msg, cls) {
  const time = new Date().toLocaleTimeString();
  logLines.value.push({ time, msg, cls });
}

watch(
  () => logLines.value.length,
  async () => {
    await nextTick();
    if (logEl.value) logEl.value.scrollTop = logEl.value.scrollHeight;
  }
);

// ---------- 导出 ----------
const exporting = ref(false);

async function doExport() {
  const d = dir.value.trim();
  if (!d) {
    log('请先设置保存目录', 'err');
    ElMessage.warning('请先设置保存目录');
    return;
  }
  if (!hasDefault.value) {
    if (confirm(`是否将「${d}」设为默认目录？\n下次打开会自动使用该目录。`)) {
      await setDefaultDir(d);
    }
  }
  exporting.value = true;
  logLines.value = [];
  log('开始导出，共 ' + selected.size + ' 个店铺…', 'info');
  try {
    const resp = await fetch('/api/export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ shopIds: [...selected], dir: d }),
    });
    if (!resp.ok || !resp.body) {
      const err = await resp.json().catch(() => ({}));
      log(err.msg || err.message || '请求失败', 'err');
      return;
    }
    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const parts = buf.split('\n\n');
      buf = parts.pop();
      for (const part of parts) {
        const line = part.split('\n').find((l) => l.startsWith('data: '));
        if (!line) continue;
        let ev;
        try {
          ev = JSON.parse(line.slice(6));
        } catch {
          continue;
        }
        if (ev.type === 'start') {
          log(`▶ ${ev.name}（${ev.shopId}）导出中…`, 'info');
        } else if (ev.type === 'done') {
          if (ev.ok) {
            log(`✓ ${ev.name}（${ev.shopId}）导出成功：${ev.rows} 条 → ${ev.file}`, 'ok');
          } else {
            log(`✕ ${ev.name}（${ev.shopId}）失败：${ev.msg}`, 'err');
          }
        } else if (ev.type === 'summary') {
          log(`完成：成功 ${ev.success} / 失败 ${ev.failed} / 共 ${ev.total} 个店铺。`, 'info');
        } else if (ev.type === 'fatal') {
          log(ev.msg, 'err');
        }
      }
    }
  } catch (e) {
    log('导出请求失败：' + e.message, 'err');
  } finally {
    exporting.value = false;
  }
}

let timer = null;
onMounted(() => {
  refreshStatus();
  loadStores();
  loadDirSettings();
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
        <template #header>③ 保存位置</template>
        <div class="dir-row">
          <el-input v-model="dir" placeholder="例如 D:\data\竞价导出" class="dir-field">
            <template #prepend>保存目录（不存在将自动创建）</template>
          </el-input>
          <el-button @click="dirPickerVisible = true">浏览</el-button>
          <el-button @click="setDefaultDir(dir)">设为默认目录</el-button>
          <el-button @click="openDir">打开目录</el-button>
        </div>
      </el-card>

      <el-card shadow="never" class="card">
        <template #header>④ 导出</template>
        <div class="actions">
          <el-button type="primary" size="large" :disabled="selCount === 0" :loading="exporting" @click="doExport">
            {{ exporting ? '导出中…' : '开始导出' }}
          </el-button>
          <el-button @click="clearAll">清空选择</el-button>
          <span class="sel-count">已选 {{ selCount }} 个店铺</span>
        </div>
        <div class="log-box">
          <div ref="logEl" class="log">
            <div v-for="(l, i) in logLines" :key="i" :class="l.cls">[{{ l.time }}] {{ l.msg }}</div>
            <div v-if="logLines.length === 0" class="log-empty">等待操作…</div>
          </div>
        </div>
      </el-card>
    </div>

    <DirPicker v-model="dirPickerVisible" @select="(v) => (dir = v)" />
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
.dir-row { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
.dir-field { flex: 1; min-width: 280px; }
.actions { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.sel-count { font-size: 13px; color: #666; }
.log-box { margin-top: 14px; }
.log {
  background: #10131c;
  color: #c8e1ff;
  font-family: Consolas, "Courier New", monospace;
  border-radius: 10px;
  padding: 14px;
  font-size: 12.5px;
  line-height: 1.7;
  max-height: 260px;
  overflow-y: auto;
  white-space: pre-wrap;
  word-break: break-all;
}
.log .ok { color: #5fd08a; }
.log .err { color: #ff7b72; }
.log .info { color: #b8c0cc; }
.log-empty { color: #8a8a8a; }
</style>