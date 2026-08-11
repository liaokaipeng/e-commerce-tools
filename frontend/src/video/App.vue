<script setup>
import { ref, reactive, computed, watch, nextTick, onMounted, onUnmounted } from 'vue';
import { ElMessage } from 'element-plus';

// ---------- 站点（跨境 .cn / 本土各站点） ----------
const SITES = [
  { key: 'cn', label: '跨境（.cn）' },
  { key: 'ph', label: '本土-菲律宾（.ph）' },
];
const site = ref('cn');
const isPh = computed(() => site.value === 'ph');
function siteLabel() {
  const s = SITES.find((x) => x.key === site.value);
  return s ? s.label : site.value;
}

// ---------- 凭证 ----------
const auth = ref('');
const cookie = ref('');
const shopId = ref('');
const userid = ref('');
const credsStatus = ref('');
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
const shopName = computed(() => shopNameOf(shopId.value));
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
  localStorage.setItem(`shopee_creds_${site.value}`, JSON.stringify({
    auth: auth.value, cookie: cookie.value, shopId: shopId.value, userid: userid.value,
  }));
}

function loadLocalCreds() {
  let c = {};
  try { c = JSON.parse(localStorage.getItem(`shopee_creds_${site.value}`) || '{}'); } catch (e) { c = {}; }
  // 跨境 cn 多店铺：不预选、不预填，由用户手动选择店铺后再填入凭证
  if (!isPh.value) {
    auth.value = '';
    cookie.value = '';
    shopId.value = '';
    userid.value = '';
    selectedShopId.value = '';
    return;
  }
  auth.value = c.auth || '';
  cookie.value = c.cookie || '';
  shopId.value = c.shopId || '';
  userid.value = c.userid || '';
  selectedShopId.value = c.shopId || '';
}

function setValIfNotFocused(id, v) {
  // 不覆盖正在编辑的输入框（auth/cookie 已不在页面展示，仅同步 shopId/userid）
  const el = document.getElementById(id);
  if (el && v && document.activeElement !== el) {
    if (id === 'shopId') shopId.value = v;
    else if (id === 'userid') userid.value = v;
  }
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
        setValIfNotFocused('shopId', cur.shopId);
        setValIfNotFocused('userid', cur.userid);
        const t = cur.updatedAt ? new Date(cur.updatedAt).toLocaleString() : '';
        credsStatus.value = '已自动获取「' + siteLabel() + '」凭证' + (t ? '（' + t + '）' : '');
        if (!quiet) saveCreds();
      } else {
        credsStatus.value = '尚未抓取到「' + siteLabel() + '」凭证，请安装扩展并在该站点短视频页手动上传一次';
      }
    } else {
      const shopsMap = (sites.cn && sites.cn.shops) || {};
      // 保留服务端全部已知店铺，无凭证的也展示（标注），避免店铺“悄悄消失”
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
        const cur = selectedShopId.value && list.find((x) => x.shopId === selectedShopId.value);
        if (cur) {
          if (cur.auth) auth.value = cur.auth;
          if (cur.cookie) cookie.value = cur.cookie;
          setValIfNotFocused('shopId', cur.shopId);
          setValIfNotFocused('userid', cur.userid);
        }
        const credCount = list.filter((x) => x.hasCred).length;
        const noCredCount = list.length - credCount;
        credsStatus.value = `已识别「${siteLabel()}」${list.length} 家店铺，其中 ${credCount} 家有凭证`
          + (noCredCount ? `，${noCredCount} 家暂无凭证（需重新上传）` : '') + '；请在上方选择店铺';
        if (!quiet) saveCreds();
      } else {
        credsStatus.value = '尚未抓取到「' + siteLabel() + '」凭证，请安装扩展并在任一店铺短视频页手动上传一次（凭证账号级通用）';
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
    ElMessage.warning('本土站点请填写 User ID（扩展会自动抓取，若为空请手动填写，见下方说明）');
    return;
  }
  if (!isPh.value && !shopIdV) {
    ElMessage.warning('跨境站点请填写 Shop ID（Authorization 可留空，会自动获取）');
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
  loadLocalCreds();
  loadCredsFromServer(true);
  fetch('/api/stores')
    .then((r) => r.json())
    .then((d) => { stores.value = Array.isArray(d) ? d : []; })
    .catch(() => { /* 服务未启动忽略 */ });
  const timer = setInterval(() => loadCredsFromServer(true), 5000);
  const stopWatch = watch(site, () => {
    loadLocalCreds();
    loadCredsFromServer(true);
  });
  onUnmounted(() => {
    clearInterval(timer);
    stopWatch();
    if (es) es.close();
  });
});
</script>

<template>
  <div class="wrap">
    <div class="container">

    <!-- 凭证 -->
    <el-card shadow="never" class="card">
        <el-collapse style="border: none">
          <el-collapse-item title="上传站点与凭证（扩展自动抓取，无需手填）" name="creds">
            <div class="row">
              <span class="site-label">上传站点</span>
              <el-select v-model="site" style="max-width: 260px">
                <el-option v-for="s in SITES" :key="s.key" :value="s.key" :label="s.label" />
              </el-select>
            </div>
            <div v-if="!isPh" class="row" style="margin-top: 8px">
              <span class="site-label">选择店铺</span>
              <el-select v-model="selectedShopId" style="min-width: 280px" placeholder="选择有凭证的店铺" @change="applyShop">
                <el-option v-for="o in shopOptions" :key="o.value" :value="o.value" :label="o.label" />
              </el-select>
            </div>
            <div v-if="!isPh" class="row" style="margin-top: 8px">
              <el-input id="shopId" v-model="shopId" style="max-width: 220px" placeholder="Shop ID">
                <template #label>Shop ID（仅跨境需要）</template>
              </el-input>
              <span v-if="shopName" class="hint shop-name">→ {{ shopName }}</span>
            </div>
            <div v-if="isPh" class="row" style="margin-top: 8px">
              <el-input id="userid" v-model="userid" style="max-width: 220px" placeholder="User ID（如 13469117809）">
                <template #label>User ID（本土上传需要，扩展会自动抓取，若为空请手动填写）</template>
              </el-input>
            </div>
            <div class="btn-row" style="margin-top: 10px">
              <el-button :loading="refreshingCreds" @click="refreshCreds">从浏览器刷新凭证</el-button>
              <span class="hint creds-status">{{ credsStatus }}</span>
            </div>
            <div class="hint">
              凭证由「KP工具合集助手」扩展自动抓取，无需手填；跨境凭证账号级通用，任一店铺上传一次即可供同账号所有店铺使用。凭证失效（报 token is expired）时重新登录并在短视频页上传一次即可。
            </div>
          </el-collapse-item>
        </el-collapse>
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
.site-label { font-size: 12px; color: #6b7280; margin-right: 8px; align-self: center; }
.creds-status { align-self: center; margin: 0; }
.shop-name { margin: 0 0 0 8px; align-self: center; color: #2f6fed; }
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
.log-line .tag { color: #7fd1ff; }
.log-line.err { color: #ff7b72; }
.log-line.ok { color: #5fd08a; }
</style>