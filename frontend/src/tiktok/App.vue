<script setup>
import { ref, computed, onMounted } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import DirRow from '../components/DirRow.vue';
import LogPanel from '../components/LogPanel.vue';
import { useDirSettings, useLog, runSSE } from '../composables/useToolPage.js';

// ---------- 状态 ----------
const urls = ref('');
const downloading = ref(false);
const abortRef = ref(null);
const proxyConnected = ref(true);
const proxyText = ref('正在检测网络环境...');
const showVpn = ref(false);

const { logLines, log, clear: clearLog } = useLog();
const progress = ref({ show: false, done: 0, ok: 0, fail: 0, total: 0 });
const summary = ref({ show: false, text: '', color: '' });

const { dir, hasDefault, loadSettings, setDefaultDir, openDir } = useDirSettings('tiktok', log);

const validCount = computed(() => {
  return urls.value
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter((s) => /^https?:\/\/(www\.|vm\.|vt\.|v\.)?tiktok\.com\//i.test(s)).length;
});

const progressPct = computed(() =>
  progress.value.total ? Math.round((progress.value.done / progress.value.total) * 100) : 0
);

// ---------- 代理状态 ----------
async function checkNetwork() {
  try {
    const r = await fetch('/api/tiktok/status');
    const data = await r.json();
    const proxyInfo = data.proxy;
    if (data.defaultDir && !dir.value) dir.value = data.defaultDir;
    proxyConnected.value = true;
    proxyText.value = proxyInfo
      ? `已检测到代理：${proxyInfo}（VPN/代理已开启，可直接下载）`
      : '未检测到系统代理，将尝试直连访问 TikTok（如失败请开启 VPN）';
    showVpn.value = false;
  } catch {
    proxyConnected.value = false;
    proxyText.value = '服务未连接，请确认已启动 main.js';
  }
}

// ---------- 下载 ----------
function handleEvent(ev) {
  switch (ev.type) {
    case 'info':
      log(ev.message, 'info', '提示');
      break;
    case 'start':
      log(`(${ev.index}/${ev.total}) ${ev.url}`, 'title', '下载');
      break;
    case 'log':
      log(ev.message, 'warn');
      break;
    case 'done': {
      progress.value.done++;
      if (ev.ok) {
        progress.value.ok++;
        log(ev.message, 'ok', '成功');
      } else {
        progress.value.fail++;
        log(ev.message, ev.network ? 'network' : 'err', '跳过');
      }
      break;
    }
    case 'fatal':
      log(ev.message, 'err', '错误');
      break;
    case 'summary': {
      summary.value = {
        show: true,
        text: ev.message,
        color: ev.failed > 0 ? '#e5484d' : '#25c16d',
      };
      break;
    }
  }
}

async function startDownload() {
  if (downloading.value) return;
  const list = urls.value
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (list.length === 0) {
    log('请先输入至少一个 TikTok 视频链接', 'err');
    return;
  }
  const d = dir.value.trim();
  if (!d) {
    log('请先选择保存目录', 'err');
    ElMessage.warning('请先选择保存目录');
    return;
  }
  if (!hasDefault.value) {
    try {
      await ElMessageBox.confirm(
        `是否将「${d}」设为默认目录？下次打开会自动使用该目录。`,
        '默认目录',
        { confirmButtonText: '设为默认', cancelButtonText: '暂不', type: 'info' }
      );
      await setDefaultDir(d);
    } catch {
      /* 用户取消，继续下载 */
    }
  }
  downloading.value = true;
  showVpn.value = false;
  clearLog();
  summary.value = { show: false, text: '', color: '' };

  log(`开始任务：共 ${list.length} 个链接`, 'title', '任务');
  let networkIssue = false;
  progress.value = { show: true, done: 0, ok: 0, fail: 0, total: list.length };

  const controller = new AbortController();
  abortRef.value = controller;
  try {
    await runSSE('/api/download', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ urls: list.join('\n'), dir: d }),
      signal: controller.signal,
    }, (ev) => {
      handleEvent(ev);
      if (ev.network) networkIssue = true;
    }, log);
  } catch (e) {
    if (e.name === 'AbortError') {
      log('已手动停止下载任务', 'warn', '提示');
    } else {
      log('连接服务失败：' + e.message, 'err');
    }
  } finally {
    downloading.value = false;
    abortRef.value = null;
  }

  if (networkIssue && !abortRef.value) showVpn.value = true;
}

function stopDownload() {
  abortRef.value?.abort();
}

async function recheckNetwork() {
  await checkNetwork();
  log('已重新检测网络环境', 'info');
}

onMounted(() => {
  checkNetwork();
  loadSettings();
});
</script>

<template>
  <div class="page">
    <div class="container">
      <el-alert :class="proxyConnected ? 'proxy-on' : 'proxy-off'" :closable="false" type="info" show-icon>
        <template #title>
          <span class="dot" :class="proxyConnected ? '' : 'off'"></span>
          {{ proxyText }}
        </template>
      </el-alert>

      <el-alert v-if="showVpn" class="vpn-alert" type="warning" :closable="false" show-icon>
        <template #title>
          <b>检测到网络连接问题，TikTok 无法访问。</b><br />
          中国大陆网络环境访问 TikTok 通常需要开启 VPN / 代理（如 Clash、v2ray 等）。<br />
          请开启后点击「重新检测网络」，再重新下载。
        </template>
      </el-alert>

      <el-card shadow="never" class="card">
        <template #header>① 输入 TikTok 视频链接</template>
        <el-input
          v-model="urls"
          type="textarea"
          :rows="8"
          placeholder="每行粘贴一个 TikTok 视频链接，例如：&#10;https://www.tiktok.com/@username/video/7439702365055290666&#10;&#10;支持 www.tiktok.com / vm.tiktok.com / v.tiktok.com 短链接"
        />
        <div class="empty-hint">{{ validCount ? `已识别 ${validCount} 个有效链接` : '' }}</div>
      </el-card>

      <el-card shadow="never" class="card">
        <template #header>② 选择保存位置</template>
        <DirRow
              v-model:dir="dir"
              placeholder="例如 D:\videos\tiktok"
          @set-default="setDefaultDir"
          @open="openDir"
        />
        <div class="actions">
          <template v-if="downloading">
            <el-button type="primary" size="large" :loading="true">下载中...</el-button>
            <el-button type="danger" size="large" @click="stopDownload">停止下载</el-button>
          </template>
          <el-button v-else type="primary" size="large" @click="startDownload">开始下载</el-button>
          <el-button size="large" @click="recheckNetwork">重新检测网络</el-button>
        </div>
      </el-card>

      <el-card shadow="never" class="card">
        <template #header>③ 下载日志</template>
        <div v-if="progress.show" class="progress-line">
          <el-progress :percentage="progressPct" :stroke-width="12" class="progress-bar" />
          <div class="progress-text">
            进度：{{ progress.done }} / {{ progress.total }}
            <span class="ok">成功 {{ progress.ok }}</span>
            <span class="err">失败 {{ progress.fail }}</span>
          </div>
        </div>
        <el-alert v-if="summary.show" :closable="false" :style="{ color: summary.color }" :title="summary.text" class="summary-alert" />
        <LogPanel :lines="logLines" height="420px" />
      </el-card>
    </div>
  </div>
</template>

<style scoped>
.proxy-on { margin-bottom: var(--sp-5); }
.proxy-off { margin-bottom: var(--sp-5); }
.vpn-alert { margin-bottom: var(--sp-5); }
.dot {
  display: inline-block;
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: var(--success-bright);
  margin-right: var(--sp-2);
}
.dot.off { background: var(--warning-bright); }
.empty-hint { color: var(--text-3); font-size: var(--fs-xs); margin-top: var(--sp-2); }
.actions { margin-top: var(--sp-4); }
.progress-line {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
  margin-bottom: var(--sp-3);
}
.progress-bar { flex: 1; min-width: 160px; }
.progress-text {
  font-size: var(--fs-sm);
  font-weight: 600;
  white-space: nowrap;
}
.progress-text .ok { color: var(--success-bright); margin-left: var(--sp-2); }
.progress-text .err { color: var(--danger-bright); margin-left: var(--sp-2); }
.summary-alert { margin-bottom: var(--sp-3); }
</style>
