<script setup>
import { ref, reactive, computed, watch, nextTick, onMounted, onUnmounted } from 'vue';
import { ElMessage } from 'element-plus';

// ---------- 凭证 ----------
const auth = ref('');
const cookie = ref('');
const shopId = ref('');
const credsStatus = ref('');
const refreshingCreds = ref(false);

function saveCreds() {
  localStorage.setItem('shopee_auth', auth.value);
  localStorage.setItem('shopee_cookie', cookie.value);
  localStorage.setItem('shopee_shopId', shopId.value);
}

function loadLocalCreds() {
  auth.value = localStorage.getItem('shopee_auth') || '';
  cookie.value = localStorage.getItem('shopee_cookie') || '';
  shopId.value = localStorage.getItem('shopee_shopId') || '';
}

function setValIfNotFocused(id, v) {
  // 不覆盖正在编辑的输入框
  const el = document.getElementById(id);
  if (el && v && document.activeElement !== el) {
    if (id === 'auth') auth.value = v;
    else if (id === 'cookie') cookie.value = v;
    else if (id === 'shopId') shopId.value = v;
  }
}

async function loadCredsFromServer(quiet) {
  try {
    const r = await fetch('/api/creds');
    const c = await r.json();
    if (c && (c.auth || c.cookie || c.shopId)) {
      setValIfNotFocused('auth', c.auth);
      setValIfNotFocused('cookie', c.cookie);
      setValIfNotFocused('shopId', c.shopId);
      const t = c.updatedAt ? new Date(c.updatedAt).toLocaleString() : '';
      credsStatus.value = '已自动获取凭证' + (t ? '（' + t + '）' : '');
      if (!quiet) saveCreds();
    } else {
      credsStatus.value = '尚未抓取到凭证，请安装扩展并在短视频页手动上传一次';
    }
  } catch (e) {
    /* 服务未启动忽略 */
  }
}

async function refreshCreds() {
  refreshingCreds.value = true;
  await loadCredsFromServer(false);
  refreshingCreds.value = false;
}

// ---------- 列名匹配 ----------
const KEY_PATH = ['视频路径', '路径', '视频', 'videopath', 'videofile', 'path', '文件', '文件路徑'];
const KEY_CAPTION = ['视频说明', '说明', '描述', '标题', 'caption', 'description', '备注', '视频描述'];
const KEY_PRODUCT = ['商品编码', '编码', '商品', 'sku', 'item', 'product', '货号', '商品id', 'itemid', '商品編碼'];

const headers = ref([]);
const mapPath = ref('');
const mapCaption = ref('');
const mapProduct = ref('');
const showMapping = ref(false);
const fileInput = ref(null);

const rows = ref([]); // 预览行：{ idx, path, caption, product, error, status }
const hasRows = computed(() => rows.value.length > 0);

function matchKey(hs, keys) {
  for (const k of keys) {
    const hit = hs.find((h) => (h || '').toString().trim().toLowerCase() === k.toLowerCase());
    if (hit) return hit;
  }
  for (const k of keys) {
    const hit = hs.find((h) => (h || '').toString().toLowerCase().includes(k.toLowerCase()));
    if (hit) return hit;
  }
  return hs[0] || '';
}

function parseCSV(text) {
  const out = [];
  let row = [],
    cur = '',
    inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cur += '"';
          i++;
        } else inQ = false;
      } else cur += ch;
    } else {
      if (ch === '"') inQ = true;
      else if (ch === ',') {
        row.push(cur);
        cur = '';
      } else if (ch === '\n') {
        row.push(cur);
        out.push(row);
        row = [];
        cur = '';
      } else if (ch === '\r') {
      } else cur += ch;
    }
  }
  if (cur !== '' || row.length) {
    row.push(cur);
    out.push(row);
  }
  if (!out.length) return [];
  const head = out[0];
  return out.slice(1).map((r) => {
    const o = {};
    head.forEach((h, i) => (o[h] = (r[i] ?? '').trim()));
    return o;
  });
}

function validateRow({ path, caption }) {
  if (!path) return '缺少视频路径';
  if (caption && caption.length > 250) return '视频说明超过250字符，请精简';
  if (caption && /tiktok/i.test(caption)) return '视频说明不能包含 tiktok 字样';
  return '';
}

async function parseFile() {
  const file = fileInput.value && fileInput.value.files ? fileInput.value.files[0] : null;
  if (!file) {
    ElMessage.warning('请先选择表格文件');
    return;
  }
  if (/\.xlsx?$/i.test(file.name) && !window.XLSX) {
    ElMessage.error('SheetJS 未加载，请确认 xlsx.full.min.js 存在');
    return;
  }
  const buf = await file.arrayBuffer();
  let raw = [];
  if (/\.xlsx?$/i.test(file.name) && window.XLSX) {
    const wb = window.XLSX.read(buf, { type: 'array' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    raw = window.XLSX.utils.sheet_to_json(ws, { defval: '' });
  } else {
    raw = parseCSV(new TextDecoder('utf-8').decode(buf));
  }
  if (!raw.length) {
    ElMessage.warning('未解析到数据');
    return;
  }
  headers.value = Object.keys(raw[0]);
  mapPath.value = matchKey(headers.value, KEY_PATH);
  mapCaption.value = matchKey(headers.value, KEY_CAPTION);
  mapProduct.value = matchKey(headers.value, KEY_PRODUCT);
  showMapping.value = true;
  rebuildRows(raw);
}

let rawRows = [];
function rebuildRows(raw) {
  rawRows = raw;
  rows.value = raw.map((r) => {
    const path = (r[mapPath.value] || '').toString().trim();
    const caption = (r[mapCaption.value] || '').toString().trim();
    const product = (r[mapProduct.value] || '').toString().trim();
    return { path, caption, product, error: validateRow({ path, caption }), status: '' };
  });
}

function onMappingChange() {
  rebuildRows(rawRows);
}

function statusTag(type) {
  return { wait: 'info', run: 'warning', ok: 'success', err: 'danger' }[type] || 'info';
}
function statusText(p) {
  return p === 'run' ? '上传中' : p === 'ok' ? '成功' : p === 'err' ? '失败' : '等待';
}

// ---------- 模板 ----------
function downloadTemplate() {
  if (!window.XLSX) {
    ElMessage.error('SheetJS 未加载，无法生成模板');
    return;
  }
  const aoa = [
    ['视频路径', '视频说明', '商品编码'],
    ['C:\\Users\\84463\\Videos\\video1.mp4', '夏季新款连衣裙展示', '18673144460'],
    ['C:\\Users\\84463\\Videos\\video2.mp4', '男士运动鞋开箱', '18673144461'],
    ['C:\\Users\\84463\\Videos\\video3.mp4', '', ''],
  ];
  const ws = window.XLSX.utils.aoa_to_sheet(aoa);
  const wb = window.XLSX.utils.book_new();
  window.XLSX.utils.book_append_sheet(wb, ws, '视频上传');
  window.XLSX.writeFile(wb, '视频批量上传模板.xlsx');
}

// ---------- 日志 ----------
const autoScroll = ref(true);
const logLines = ref([]);
const logEl = ref(null);

function log(msg, cls) {
  const time = new Date().toLocaleTimeString();
  logLines.value.push({ time, msg, cls });
  nextTick(() => {
    if (autoScroll.value && logEl.value) logEl.value.scrollTop = logEl.value.scrollHeight;
  });
}

function clearLog() {
  logLines.value = [];
}

// ---------- 上传 ----------
const uploading = ref(false);
const summary = ref('');
let es = null;

function startUpload() {
  saveCreds();
  const authV = auth.value.trim();
  const cookieV = cookie.value.trim();
  const shopIdV = shopId.value.trim();
  if (!cookieV || !shopIdV) {
    ElMessage.warning('请先填写 Cookie 与 Shop ID（Authorization 可留空，会自动获取）');
    return;
  }

  uploading.value = true;
  logLines.value = [];
  summary.value = '';
  log('开始批量上传，共 ' + rows.value.length + ' 个任务', 'ok');

  const mapped = rows.value.map((r) => ({ path: r.path, caption: r.caption, product: r.product }));

  fetch('/api/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rows: mapped, auth: authV, cookie: cookieV, shopId: shopIdV }),
  })
    .then((r) => r.json())
    .then(({ jobId }) => {
      es = new EventSource('/api/events?jobId=' + jobId);
      let done = 0,
        ok = 0,
        fail = 0,
        total = 0;
      const updateSummary = () => {
        summary.value = `进度：${done} / ${total}　成功 ${ok} / 失败 ${fail}`;
      };
      es.onmessage = (ev) => {
        const d = JSON.parse(ev.data);
        if (d.type === 'row-start') {
          total = d.total;
          updateSummary();
          const row = rows.value[d.index];
          if (row) row.status = 'run';
          log(`▶ 任务 ${d.index + 1}/${d.total}: ${d.row.path}`);
        } else if (d.type === 'step') {
          log(`    [${d.index + 1}] (${d.step}) ${d.msg}`);
        } else if (d.type === 'row-done') {
          done++;
          ok++;
          updateSummary();
          const row = rows.value[d.index];
          if (row) row.status = 'ok';
          log(`  ✓ 任务 ${d.index + 1} 完成 → vid=${d.result.vid}` + (d.result.itemId ? ` item_id=${d.result.itemId}` : ''), 'ok');
        } else if (d.type === 'row-error') {
          done++;
          fail++;
          updateSummary();
          const row = rows.value[d.index];
          if (row) row.status = 'err';
          log(`  ✗ 任务 ${d.index + 1} 失败: ${d.error}`, 'err');
        } else if (d.type === 'finished') {
          log(`全部完成：成功 ${ok}，失败 ${fail}，共 ${d.total}`, ok ? 'ok' : 'err');
          summary.value = `已完成：成功 ${ok} / 失败 ${fail}`;
          uploading.value = false;
          if (es) es.close();
        } else if (d.type === 'fatal') {
          log('致命错误: ' + d.error, 'err');
          uploading.value = false;
        }
      };
      es.onerror = () => {
        log('SSE 连接中断', 'err');
        uploading.value = false;
      };
    })
    .catch((e) => {
      log('启动失败: ' + e.message, 'err');
      uploading.value = false;
    });
}

onMounted(() => {
  loadLocalCreds();
  loadCredsFromServer(true);
  const timer = setInterval(() => loadCredsFromServer(true), 5000);
  onUnmounted(() => {
    clearInterval(timer);
    if (es) es.close();
  });
});
</script>

<template>
  <div class="wrap">
    <h1>Shopee 视频批量上传</h1>
    <div class="sub">根据抓包接口还原的本地上传工具 · 视频路径/说明/商品编码存于表格，按行批量上传并关联商品</div>

    <!-- 凭证 -->
    <el-card shadow="never" class="card">
      <template #header>
        <el-collapse style="border: none">
          <el-collapse-item title="接口凭证（可留空，服务端会用 Cookie 自动刷新 Authorization）" name="creds">
            <div class="row">
              <el-input v-model="auth" placeholder="可留空，自动获取">
                <template #label>Authorization（分片上传用，可留空，服务端会自动获取）</template>
              </el-input>
            </div>
            <div class="row" style="margin-top: 8px">
              <el-input v-model="cookie" type="textarea" :rows="3" placeholder="Cookie（item/list 与 video/create 用，含 video_upload_session_id 等）">
                <template #label>Cookie</template>
              </el-input>
            </div>
            <div class="row" style="margin-top: 8px">
              <el-input v-model="shopId" style="max-width: 220px" placeholder="Shop ID">
                <template #label>Shop ID</template>
              </el-input>
            </div>
            <div class="btn-row" style="margin-top: 10px">
              <el-button :loading="refreshingCreds" @click="refreshCreds">从浏览器刷新凭证</el-button>
              <span class="hint creds-status">{{ credsStatus }}</span>
            </div>
            <div class="hint">
              安装「凭证抓取」浏览器扩展后，在 Shopee 短视频页手动上传一次视频，扩展会自动抓取 Cookie/ShopID 并填入。Authorization
              时效很短，无需手动抓取——服务端每次上传前会用 Cookie 自动换取新 token。Cookie
              失效时（上传报 token is expired）重新登录并在短视频页上传一次即可。
            </div>
          </el-collapse-item>
        </el-collapse>
      </template>
    </el-card>

    <!-- 表格 -->
    <el-card shadow="never" class="card">
      <template #header>
        <span>① 选择表格</span>
        <el-tag size="small" effect="light" class="pill">支持 .xlsx / .xls / .csv</el-tag>
      </template>
      <div class="file-row">
        <input ref="fileInput" type="file" accept=".xlsx,.xls" class="file-input" />
        <div class="hint">
          使用 <b>.xlsx</b> 表格。表头需包含：<b>视频路径</b>（本地文件完整路径）、<b>视频说明</b>（caption）、<b>商品编码</b>（用于查询并关联商品）。如列名不同，可在下方手动映射。
        </div>
      </div>

      <div v-if="showMapping" class="mapping">
        <div class="grid3">
          <div>
            <label>视频路径列</label>
            <el-select v-model="mapPath" @change="onMappingChange">
              <el-option v-for="h in headers" :key="h" :value="h" :label="h || '(空)'" />
            </el-select>
          </div>
          <div>
            <label>视频说明列</label>
            <el-select v-model="mapCaption" @change="onMappingChange">
              <el-option v-for="h in headers" :key="h" :value="h" :label="h || '(空)'" />
            </el-select>
          </div>
          <div>
            <label>商品编码列</label>
            <el-select v-model="mapProduct" @change="onMappingChange">
              <el-option v-for="h in headers" :key="h" :value="h" :label="h || '(空)'" />
            </el-select>
          </div>
        </div>
      </div>

      <div class="btn-row">
        <el-button type="primary" @click="parseFile">解析表格</el-button>
        <el-button @click="downloadTemplate">下载 xlsx 模板</el-button>
      </div>

      <div v-if="hasRows" class="preview">
        <el-table :data="rows" size="small" max-height="320" border>
          <el-table-column type="index" label="#" width="50" />
          <el-table-column prop="path" label="视频路径" min-width="200" show-overflow-tooltip />
          <el-table-column prop="caption" label="视频说明" min-width="140" show-overflow-tooltip />
          <el-table-column prop="product" label="商品编码" min-width="120" />
          <el-table-column label="状态" width="100">
            <template #default="{ row }">
              <el-tag v-if="row.error" type="danger" size="small" :title="row.error">{{ row.error }}</el-tag>
              <el-tag v-else :type="statusTag(row.status)" size="small">{{ statusText(row.status) }}</el-tag>
            </template>
          </el-table-column>
        </el-table>
      </div>
    </el-card>

    <!-- 执行 -->
    <el-card shadow="never" class="card">
      <template #header>② 开始批量上传</template>
      <div class="btn-row">
        <el-button type="primary" :disabled="!hasRows" :loading="uploading" @click="startUpload">
          {{ uploading ? '上传中…' : '开始上传' }}
        </el-button>
        <el-button @click="clearLog">清空日志</el-button>
        <el-button @click="autoScroll = !autoScroll">{{ autoScroll ? '暂停滚动' : '继续滚动' }}</el-button>
      </div>
      <div v-if="summary" class="hint" style="margin-top: 10px">{{ summary }}</div>
      <div ref="logEl" class="log">
        <div v-for="(l, i) in logLines" :key="i" class="log-line" :class="l.cls">[{{ l.time }}] {{ l.msg }}</div>
      </div>
    </el-card>
  </div>
</template>

<style scoped>
.wrap {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
  background: #f4f6fb;
  color: #1f2330;
  line-height: 1.5;
  max-width: 960px;
  margin: 0 auto;
  padding: 24px 16px 60px;
  box-sizing: border-box;
}
h1 { font-size: 22px; margin: 0 0 4px; }
.sub { color: #6b7280; font-size: 13px; margin-bottom: 20px; }
.card { margin-bottom: 18px; }
.pill { margin-left: 8px; }
.file-row { display: flex; flex-direction: column; gap: 8px; }
.file-input { padding: 4px 0; }
.hint { font-size: 12px; color: #9aa0ad; margin-top: 6px; }
.creds-status { align-self: center; margin: 0; }
.btn-row { display: flex; gap: 12px; margin-top: 6px; flex-wrap: wrap; align-items: center; }
.mapping { margin-top: 14px; }
.grid3 {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 12px;
}
@media (max-width: 720px) {
  .grid3 { grid-template-columns: 1fr; }
}
.grid3 label { display: block; font-size: 12px; color: #6b7280; margin: 0 0 4px; }
.preview { margin-top: 14px; }
.log {
  background: #0f1320;
  color: #c8e1ff;
  font-family: ui-monospace, Menlo, Consolas, monospace;
  font-size: 12px;
  border-radius: 10px;
  padding: 14px;
  height: 320px;
  overflow: auto;
  margin-top: 12px;
  white-space: pre-wrap;
}
.log-line { margin: 0 0 2px; }
.log-line .tag { color: #7fd1ff; }
.log-line.err { color: #ff8585; }
.log-line.ok { color: #7cfc9b; }
</style>