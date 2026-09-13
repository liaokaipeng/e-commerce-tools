<script setup>
import { ref, reactive, onMounted } from 'vue';
import { ElMessage } from 'element-plus';
import { runSSE } from '../composables/useToolPage.js';

// 各工具各用一个 iframe，首次访问时加载并常驻 DOM。
// 切换 Tab 只改变 display，不重新加载页面，从而保留各 Tab 状态。
// 视频上传按站点拆分为两个入口（跨境 / 本土），共用 /video/ 页面，经 ?mode=cn|ph 区分站点。
const tabs = [
  { key: 'bidding', label: '竞价导出', sub: '获胜数据 → Excel', group: 'Shopee', src: '/bidding/' },
  { key: 'bidding-cancel', label: '取消竞价', sub: '批量撤销待改进竞价', group: 'Shopee', src: '/bidding-cancel/' },
  { key: 'hotlisting-cancel', label: '取消Hot Listing', sub: '批量取消注册已注册 SKU', group: 'Shopee', src: '/hotlisting-cancel/' },
  { key: 'video-cn', label: '跨境视频上传', sub: '批量上传并关联商品', group: 'Shopee', src: '/video/?mode=cn' },
  { key: 'video-ph', label: '本土视频上传', sub: '菲律宾站点批量上传', group: 'Shopee', src: '/video/?mode=ph' },
  { key: 'openapi', label: '开放平台', sub: 'App 授权与 Token 管理', group: 'Shopee', src: '/openapi/' },
  { key: 'monitor', label: '监控大屏', sub: '多店巡检三级告警', group: 'Shopee', src: '/monitor/' },
  { key: 'tiktok', label: '视频下载', sub: '批量无水印下载', group: 'TikTok', src: '/tiktok/' },
];

const active = ref('bidding');
// 用 reactive 包裹，add/delete 会触发视图更新（否则首次挂载后 iframe src 不会刷新）
const loaded = reactive(new Set());

// ============ 版本与更新（侧栏底部入口，见 server/update.js） ============
const ver = ref({ version: '', commit: null, builtAt: null });
const upd = ref({ configured: false, enabled: true, hasUpdate: false, latest: null, current: {}, notes: '', url: '', sha256: '', builtAt: null, checkedAt: null, error: null });
const updateDrawer = ref(false);
const checking = ref(false);
const applying = ref(false);
const steps = ref([]);
const doneInfo = ref(null);

function fmtTime(iso) {
  if (!iso) return '';
  return String(iso).slice(0, 19).replace('T', ' ');
}

async function loadVersion() {
  try {
    const r = await fetch('/api/version');
    const s = await r.json();
    if (s.ok) ver.value = s;
  } catch { /* 服务不可达时侧栏显示占位符即可 */ }
}

/** 拉取更新清单并比对；失败静默（侧栏显示「检查失败」小点），手动触发时才提示 */
async function checkUpdate(manual = false) {
  checking.value = true;
  try {
    const r = await fetch('/api/update/check');
    const s = await r.json();
    if (s.ok) upd.value = s;
    if (manual) {
      if (s.error) ElMessage.warning('检查更新失败：' + s.error);
      else if (s.hasUpdate) ElMessage.success(`发现新版本 v${s.latest}`);
      else ElMessage.success(`已是最新版本 v${ver.value.version}`);
    }
  } catch {
    if (manual) ElMessage.warning('检查更新失败：连接服务失败');
  } finally {
    checking.value = false;
  }
}

/** 一键更新：SSE 进度（下载 → 校验 → 解压 → 备份 → 覆盖 → 依赖） */
async function applyUpdate() {
  applying.value = true;
  steps.value = [];
  doneInfo.value = null;
  try {
    await runSSE('/api/update/apply', { method: 'POST' }, (ev) => {
      if (ev.phase === 'done') {
        doneInfo.value = ev;
      } else if (ev.phase === 'error') {
        steps.value.push({ phase: 'error', message: ev.message });
      } else if (ev.phase === 'download' && typeof ev.percent === 'number') {
        // 下载进度覆盖同阶段最新一条，避免刷屏
        const last = steps.value[steps.value.length - 1];
        if (last && last.phase === 'download') last.percent = ev.percent;
        else steps.value.push({ phase: ev.phase, message: ev.message, percent: ev.percent });
      } else {
        steps.value.push({ phase: ev.phase, message: ev.message });
      }
    }, () => {});
  } finally {
    applying.value = false;
    checkUpdate();
  }
}

function openUpdate() {
  updateDrawer.value = true;
  if (!upd.value.checkedAt) checkUpdate();
}

function downloadPackage() {
  if (upd.value.url) window.open(upd.value.url, '_blank');
}

function show(key) {
  active.value = key;
  const tab = tabs.find((t) => t.key === key);
  if (tab && !loaded.has(key)) {
    loaded.add(key);
  }
  notifyTabs(key);
}

/** 通知所有已加载 iframe 当前激活的 Tab（监控大屏据此启停按需采集） */
function notifyTabs(key) {
  for (const f of Array.from(document.querySelectorAll('iframe'))) {
    try {
      f.contentWindow && f.contentWindow.postMessage({ type: 'portal-tab', key }, location.origin);
    } catch { /* 忽略跨源 iframe */ }
  }
}

function isActive(key) {
  return active.value === key;
}

function iframeSrc(tab) {
  // 仅当该 Tab 被激活时才真正赋值 src，避免一次性加载全部页面
  return loaded.has(tab.key) ? tab.src : undefined;
}

// 首次打开即加载默认 Tab（竞价导出），否则其 iframe 无 src 显示空白
onMounted(() => {
  show(active.value);
  // 版本显示与更新检查（静默，失败不打扰）
  loadVersion();
  checkUpdate();
  // 子页面（如监控大屏）可通过 parent.postMessage 请求切换 Tab；
  // 监控大屏加载完成后发 monitor-ready 询问当前激活 Tab（用于按需采集启停）
  window.addEventListener('message', (ev) => {
    const d = ev.data;
    if (d && d.type === 'switch-tab' && tabs.some((t) => t.key === d.key)) {
      show(d.key);
    } else if (d && d.type === 'monitor-ready') {
      try {
        ev.source && ev.source.postMessage({ type: 'portal-tab', key: active.value }, location.origin);
      } catch { /* 忽略 */ }
    }
  });
});
</script>

<template>
  <div class="portal">
    <aside class="sidebar">
      <div class="brand">
        <span class="brand-text">
          <b>电商工具箱</b>
        </span>
      </div>
      <nav>
        <template v-for="g in ['Shopee', 'TikTok']" :key="g">
          <span class="g-label">{{ g }}</span>
          <button
            v-for="t in tabs.filter((x) => x.group === g)"
            :key="t.key"
            :class="{ active: isActive(t.key) }"
            :title="t.sub"
            @click="show(t.key)"
          >
            {{ t.label }}<small>{{ t.sub }}</small>
          </button>
        </template>
      </nav>
      <div class="ver-bar" title="版本与更新" @click="openUpdate">
        <span class="ver-text">v{{ ver.version || '…' }}</span>
        <span v-if="upd.hasUpdate" class="ver-badge">新 v{{ upd.latest }}</span>
        <span v-else-if="upd.error" class="ver-warn" title="更新检查失败">检查失败</span>
      </div>
    </aside>
    <div class="frame-wrap">
      <iframe
        v-for="t in tabs"
        :key="t.key"
        :class="{ active: isActive(t.key) }"
        :title="t.label"
        :src="iframeSrc(t)"
      ></iframe>
    </div>

    <el-drawer v-model="updateDrawer" title="版本与更新" size="430px">
      <div class="upd">
        <div class="upd-row">
          <span class="upd-label">当前版本</span>
          <b>v{{ upd.current.version || ver.version }}</b>
          <span v-if="upd.current.commit" class="upd-meta">{{ upd.current.commit }} · {{ fmtTime(upd.current.builtAt) }}</span>
        </div>

        <el-alert
          v-if="!upd.configured"
          type="info"
          :closable="false"
          title="未配置更新源"
          description="server/config/update.json 的 manifestUrl 留空时不会检查更新；填入 GitHub 清单地址即可启用。"
        />
        <el-alert
          v-else-if="upd.error"
          type="warning"
          :closable="false"
          :title="'更新检查失败：' + upd.error"
          description="不影响工具使用；可点「检查更新」重试，或直接用下方链接手动下载。"
        />
        <el-alert
          v-else-if="upd.hasUpdate"
          type="success"
          :closable="false"
          :title="`发现新版本 v${upd.latest}`"
          :description="`发布时间：${fmtTime(upd.builtAt) || '未知'}`"
        />
        <el-alert
          v-else-if="upd.latest"
          type="info"
          :closable="false"
          :title="`远端最新为 v${upd.latest}，已是最新版本`"
        />

        <p v-if="upd.notes" class="upd-notes">{{ upd.notes }}</p>

        <div class="upd-actions">
          <el-button :loading="checking" :disabled="applying" @click="checkUpdate(true)">检查更新</el-button>
          <el-button
            type="primary"
            :loading="applying"
            :disabled="!upd.hasUpdate || !upd.configured"
            @click="applyUpdate"
          >一键更新</el-button>
          <el-button link :disabled="!upd.url" @click="downloadPackage">下载安装包</el-button>
        </div>

        <ul v-if="steps.length" class="upd-steps">
          <li v-for="(s, i) in steps" :key="i" :class="s.phase">
            {{ s.message }}
            <el-progress
              v-if="typeof s.percent === 'number'"
              :percentage="s.percent"
              :stroke-width="6"
            />
          </li>
        </ul>

        <el-alert
          v-if="doneInfo"
          type="success"
          :closable="false"
          :title="`已更新到 v${doneInfo.version}，重启后生效`"
          :description="'关闭本窗口后重新双击 启动.bat 即可。'
            + (doneInfo.backup ? `更新前的数据已备份到 ${doneInfo.backup}。` : '')
            + '浏览器扩展若是新版本，需在 edge://extensions 点「重新加载」。'"
        />
        <el-alert
          v-if="doneInfo && doneInfo.depsWarning"
          type="warning"
          :closable="false"
          :title="'依赖安装未完成：' + doneInfo.depsWarning"
        />
      </div>
    </el-drawer>
  </div>
</template>

<style scoped>
* { box-sizing: border-box; margin: 0; padding: 0; }
.portal {
  /* 深色侧栏令牌：与监控大屏（monitor.css 的 --d-*）同源，两处深色观感一致 */
  --p-bg: #f4f6fb;          /* 内容区（iframe 之外的留白） */
  --p-sidebar: #111527;     /* 与监控大屏顶栏一致 */
  --p-border: #1e2440;
  --p-text-1: #eef1f8;      /* 标题 */
  --p-text-2: #d3d9e8;      /* 正文 / 菜单项 */
  --p-text-3: #99a1b8;      /* 分组标签 / 次要说明 */
  --p-brand: #ee4d2d;
  --p-hover: rgba(255, 255, 255, 0.16);
  --p-rest: rgba(255, 255, 255, 0.08);
  --p-radius-sm: 8px;
  --p-radius-md: 10px;

  font-family: "Microsoft YaHei", "PingFang SC", -apple-system, "Segoe UI", "Helvetica Neue", Arial, sans-serif;
  font-size: 14px;
  line-height: 1.5;
  background: var(--p-bg);
  color: #23262f;
  height: 100vh;
  display: flex;
  flex-direction: row;
}
.sidebar {
  flex: none;
  width: 208px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  overflow-y: auto; /* 菜单过多时侧栏纵向滚动 */
  background: var(--p-sidebar);
  border-right: 1px solid var(--p-border);
  color: var(--p-text-2);
  padding: 16px 14px;
  /* 深色侧栏的原生滚动条也要跟着变深，否则 Windows 上会露出一条浅灰滚动条 */
  color-scheme: dark;
  scrollbar-width: thin;
  scrollbar-color: #2f3a5c transparent;
}
.sidebar::-webkit-scrollbar { width: 10px; }
.sidebar::-webkit-scrollbar-track { background: transparent; }
.sidebar::-webkit-scrollbar-thumb {
  background: #2f3a5c;
  background-clip: padding-box;
  border: 2px solid transparent;
  border-radius: 999px;
}
.sidebar::-webkit-scrollbar-thumb:hover { background: #3d4a72; background-clip: padding-box; }
.brand {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: none;
  padding: 0 4px 12px;
  border-bottom: 1px solid var(--p-border);
}
.logo {
  width: 34px;
  height: 34px;
  background: var(--p-brand);
  border-radius: var(--p-radius-md);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  font-weight: 700;
  color: #fff;
  box-shadow: 0 2px 8px rgba(238, 77, 45, 0.45);
}
.brand b { font-size: 16px; font-weight: 600; color: var(--p-text-1); display: block; line-height: 1.2; }
.brand small {
  display: block;
  font-size: 11px;
  font-weight: 400;
  color: var(--p-text-3);
  line-height: 1.2;
}
nav {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.g-label {
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 1px;
  color: var(--p-text-3);
  margin-top: 6px;
  white-space: nowrap;
}
.g-label:first-child { margin-top: 0; }
nav button {
  border: none;
  background: var(--p-rest);
  color: var(--p-text-2);
  padding: 8px 12px;
  border-radius: var(--p-radius-sm);
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: background-color 0.15s, color 0.15s, transform 0.15s, box-shadow 0.15s;
  font-family: inherit;
  white-space: nowrap;
  text-align: left;
}
nav button:hover { background: var(--p-hover); color: #fff; }
nav button.active {
  background: var(--p-brand);
  color: #fff;
  box-shadow: 0 2px 10px rgba(238, 77, 45, 0.5);
  transform: translateX(2px);
}
nav button small {
  display: block;
  font-size: 11px;
  font-weight: 400;
  color: var(--p-text-3);
  transition: color 0.15s;
}
nav button.active small, nav button:hover small { color: rgba(255, 255, 255, 0.82); }
.frame-wrap { flex: 1; position: relative; }

/* ============ 侧栏底部：版本与更新入口 ============ */
.ver-bar {
  margin-top: auto;
  flex: none;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-radius: var(--p-radius-sm);
  background: var(--p-rest);
  color: var(--p-text-3);
  font-size: 12px;
  cursor: pointer;
  transition: background-color 0.15s, color 0.15s;
  white-space: nowrap;
}
.ver-bar:hover { background: var(--p-hover); color: var(--p-text-2); }
.ver-text { font-variant-numeric: tabular-nums; }
.ver-badge {
  background: var(--p-brand);
  color: #fff;
  font-size: 11px;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 999px;
}
.ver-warn { color: #e6a23c; }

/* ============ 更新抽屉内容 ============ */
.upd { display: flex; flex-direction: column; gap: 14px; font-size: 13px; }
.upd-row { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
.upd-label { color: #909399; }
.upd-meta { color: #909399; font-size: 12px; }
.upd-notes {
  margin: 0;
  padding: 10px 12px;
  background: #f5f7fa;
  border-radius: 6px;
  white-space: pre-wrap;
  line-height: 1.6;
  color: #444;
}
.upd-actions { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; }
.upd-steps {
  margin: 0;
  padding: 10px 12px 10px 28px;
  background: #f5f7fa;
  border-radius: 6px;
  line-height: 1.8;
  color: #555;
  list-style: disc;
  font-size: 12px;
}
.upd-steps li.error { color: #d03050; }
.upd-steps li.done { color: #18a058; }
.upd-steps li { word-break: break-all; }
iframe {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  border: none;
  background: #fff;
  visibility: hidden;
}
iframe.active { visibility: visible; }
@media (max-width: 640px) {
  .brand-text b { font-size: 12px; }
  .sidebar { width: 64px; padding: 12px 8px; }
  nav button { padding: 8px; font-size: 12px; }
  nav button small, .g-label { display: none; }
}
</style>