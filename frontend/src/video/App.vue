<script setup>
import { ref, computed, nextTick, onMounted, onUnmounted } from 'vue';
import { ElMessage } from 'element-plus';

// ---------- 站点（门户已按站点拆分为「跨境视频上传」「本土视频上传」两个入口） ----------
// 本页站点由 URL 参数 ?mode=cn|ph 固定，不再提供站内切换。
const SITES = {
  cn: { key: 'cn', label: '跨境（.cn）' },
  ph: { key: 'ph', label: '本土-菲律宾（.ph）' },
};
const modeParam = new URLSearchParams(window.location.search).get('mode');
const site = ref(SITES[modeParam] ? modeParam : 'cn');
const isPh = computed(() => site.value === 'ph');
function siteLabel() {
  return SITES[site.value].label;
}

// ---------- 凭证 ----------
const auth = ref('');
const cookie = ref('');
const shopId = ref('');
const userid = ref('');
const refreshingCreds = ref(false);

// 跨境 cn 多店铺：有凭证的店铺列表与当前选中店铺
const cnShops = ref([]); // [{ shopId, auth, cookie, userid, updatedAt }]
const selectedShopId = ref('');

// 店铺列表（复用 stores.json，用于把 shopId 展示成店名，参考竞价导出）
const stores = ref([]);
function shopNameOf(id) {
  const s = stores.value.find((x) => String(x.id) === String(id));
  return s ? s.name : '';
}
// 店铺下拉选项：展示全部已知店铺，无凭证的加标注
const shopOptions = computed(() => cnShops.value.map((s) => {
  const base = shopNameOf(s.shopId) ? `${shopNameOf(s.shopId)}（${s.shopId}）` : `店铺 ${s.shopId}`;
  return { value: s.shopId, label: s.hasCred ? base : `${base}（无凭证，需上传一次）` };
}));
function applyShop(id) {
  const s = cnShops.value.find((x) => x.shopId === String(id));
  if (!s) return;
  auth.value = s.auth || '';
  cookie.value = s.cookie || '';
  shopId.value = s.shopId;
  userid.value = s.userid || '';
  saveCreds();
  if (!s.hasCred) {
    ElMessage.warning(`店铺 ${s.shopId} 暂无有效凭证，请登录同账号下任一店铺短视频页手动上传一次以抓取凭证（凭证账号级通用）`);
  }
}

function saveCreds() {
  // 跨境 cn 页面凭证由扩展抓取、按店铺存于服务端，本地仅记住所选店铺；本土 ph 完整记住凭证
  const data = isPh.value
    ? { auth: auth.value, cookie: cookie.value, shopId: shopId.value, userid: userid.value }
    : { shopId: shopId.value || selectedShopId.value };
  localStorage.setItem(`shopee_creds_${site.value}`, JSON.stringify(data));
}

function loadLocalCreds() {
  let c = {};
  try { c = JSON.parse(localStorage.getItem(`shopee_creds_${site.value}`) || '{}'); } catch (e) { c = {}; }
  // 跨境 cn：页面无店铺控件，仅记住上次自动选中的店铺，保持发布目标稳定
  if (!isPh.value) {
    auth.value = '';
    cookie.value = '';
    shopId.value = '';
    userid.value = '';
    selectedShopId.value = c.shopId || '';
    return;
  }
  auth.value = c.auth || '';
  cookie.value = c.cookie || '';
  shopId.value = c.shopId || '';
  userid.value = c.userid || '';
  selectedShopId.value = c.shopId || '';
}

function setUseridIfNotFocused(v) {
  const el = document.getElementById('userid');
  if (el && v && document.activeElement !== el) userid.value = v;
}

async function loadCredsFromServer(quiet) {
  try {
    const r = await fetch('/api/creds');
    const c = await r.json();
    const sites = (c && c.sites) || {};
    if (isPh.value) {
      const cur = sites.ph || null;
      if (cur && (cur.auth || cur.cookie || cur.shopId || cur.userid)) {
        // auth/cookie 已无可见输入框，不会被用户编辑，直接从服务端同步
        if (cur.auth) auth.value = cur.auth;
        if (cur.cookie) cookie.value = cur.cookie;
        setUseridIfNotFocused(cur.userid);
        const t = cur.updatedAt ? new Date(cur.updatedAt).toLocaleString() : '';
        if (!quiet) saveCreds();
      } 
    } else {
      const shopsMap = (sites.cn && sites.cn.shops) || {};
      const list = Object.entries(shopsMap)
        .map(([id, v]) => {
          const auth = (v && v.auth) || '';
          const cookie = (v && v.cookie) || '';
          return {
            shopId: id,
            auth,
            cookie,
            userid: (v && v.userid) || '',
            updatedAt: (v && v.updatedAt) || 0,
            hasCred: !!(auth || cookie),
          };
        })
        .sort((a, b) => Number(b.hasCred) - Number(a.hasCred));
      cnShops.value = list;
      if (list.length) {
        // 优先沿用当前所选店铺（用户手动选择或上次记住的），未选择时自动挑最近更新的有凭证店铺
        const withCred = list
          .filter((x) => x.hasCred)
          .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
        let cur = selectedShopId.value ? list.find((x) => x.shopId === selectedShopId.value) : null;
        if (!cur) cur = withCred[0] || list[0];
        if (selectedShopId.value !== cur.shopId) {
          selectedShopId.value = cur.shopId;
          saveCreds();
        }
        if (cur.auth) auth.value = cur.auth;
        if (cur.cookie) cookie.value = cur.cookie;
        shopId.value = cur.shopId;
        if (cur.userid) userid.value = cur.userid;
        if (!quiet) saveCreds();
      } 
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
  if (!rows.value.length) {
    ElMessage.warning('请先解析并导入表格');
    return;
  }
  saveCreds();
  const authV = auth.value.trim();
  const cookieV = cookie.value.trim();
  const shopIdV = shopId.value.trim();
  const useridV = userid.value.trim();
  if (isPh.value && !cookieV) {
    ElMessage.warning('尚未获取到该站点凭证：请安装扩展，登录卖家中心并在短视频页手动上传一次以自动抓取');
    return;
  }
  if (!isPh.value && !cnShops.value.some((s) => s.hasCred)) {
    ElMessage.warning('尚未获取到跨境凭证：请安装扩展，在任一店铺短视频页手动上传一次以自动抓取（凭证账号级通用）');
    return;
  }
  if (isPh.value && !useridV) {
    ElMessage.warning('本土站点请填写 User ID（扩展会自动抓取，若为空请手动填写）');
    return;
  }
  if (!isPh.value && !shopIdV) {
    ElMessage.warning('未识别到可用的跨境店铺：请安装扩展，在任一店铺短视频页手动上传一次以自动抓取凭证');
    return;
  }

  uploading.value = true;
  logLines.value = [];
  summary.value = '';
  log(`开始批量上传（${siteLabel()}），共 ${rows.value.length} 个任务`, 'ok');

  const mapped = rows.value.map((r) => ({ path: r.path, caption: r.caption, product: r.product }));

  fetch('/api/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ site: site.value, rows: mapped, auth: authV, cookie: cookieV, shopId: shopIdV, userid: useridV }),
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
  document.title = isPh.value ? '本土视频批量上传' : '跨境视频批量上传';
  loadLocalCreds();
  loadCredsFromServer(true);
  fetch('/api/stores')
    .then((r) => r.json())
    .then((d) => { stores.value = Array.isArray(d) ? d : []; })
    .catch(() => { /* 服务未启动忽略 */ });
  const timer = setInterval(() => loadCredsFromServer(true), 5000);
  onUnmounted(() => {
    clearInterval(timer);
    if (es) es.close();
  });
});
</script>

<template>
  <div class="wrap">
    <div class="container">

    <!-- 凭证 -->
    <el-card shadow="never" class="card">
      <template #header><span>上传凭证</span></template>
      <div v-if="!isPh" class="row">
        <el-select v-model="selectedShopId" style="min-width: 280px" placeholder="选择要发布到的店铺" @change="applyShop">
          <el-option v-for="o in shopOptions" :key="o.value" :value="o.value" :label="o.label" />
        </el-select>
      </div>
      <div v-if="isPh" class="row">
        <span class="field-label">User ID（本土上传需要，扩展会自动抓取，若为空请手动填写）</span>
        <el-input id="userid" v-model="userid" style="max-width: 220px" placeholder="如 13469117809" />
      </div>
      <div class="btn-row" style="margin-top: 10px">
        <el-button :loading="refreshingCreds" @click="refreshCreds">从浏览器刷新凭证</el-button>
      </div>
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
          表头需包含：<b>视频路径</b>、<b>视频说明</b>、<b>商品编码</b>；如列名不同，可在下方手动映射。
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
  </div>
</template>

<style scoped>
.wrap {
  font-family: "Microsoft YaHei", "PingFang SC", -apple-system, "Segoe UI", sans-serif;
  background: #f4f6fb;
  color: #1f2330;
  line-height: 1.5;
  min-height: 100vh;
  padding: 28px 20px 0;
  box-sizing: border-box;
}
.container { max-width: 900px; margin: 0 auto; padding-bottom: 60px; }
.card { margin-bottom: 18px; border-radius: 14px; }
.pill { margin-left: 8px; }
.file-row { display: flex; flex-direction: column; gap: 8px; }
.file-input { padding: 4px 0; }
.hint { font-size: 12px; color: #9aa0ad; margin-top: 6px; }
.field-label { font-size: 12px; color: #6b7280; margin-right: 8px; }
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
  background: #10131c;
  color: #c8e1ff;
  font-family: Consolas, "Courier New", monospace;
  font-size: 12.5px;
  border-radius: 10px;
  padding: 14px;
  height: 320px;
  overflow: auto;
  margin-top: 12px;
  white-space: pre-wrap;
}
.log-line { margin: 0 0 2px; }
.log-line.err { color: #ff7b72; }
.log-line.ok { color: #5fd08a; }
</style>