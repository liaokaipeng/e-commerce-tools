<script setup>
import { ref, computed, watch, nextTick, onMounted } from 'vue';
import { ElMessage } from 'element-plus';
import DirPicker from '../components/DirPicker.vue';

// ---------- 状态 ----------
const urls = ref('');
const dir = ref('');
const downloading = ref(false);
const proxyConnected = ref(true);
const proxyText = ref('正在检测网络环境...');
const showVpn = ref(false);
const hasDefault = ref(false);
const dirPickerVisible = ref(false);

const logLines = ref([]);
const progress = ref({ show: false, done: 0, ok: 0, fail: 0, total: 0 });
const summary = ref({ show: false, text: '', color: '' });

const validCount = computed(() => {
  return urls.value
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter((s) => /^https?:\/\/(www\.|vm\.|vt\.|v\.)?tiktok\.com\//i.test(s)).length;
});

function log(message, cls = 'info', title = '') {
  const time = new Date().toLocaleTimeString('zh-CN', { hour12: false });
  logLines.value.push({ time, cls, title, message });
}

const logEl = ref(null);
watch(
  () => logLines.value.length,
  async () => {
    await nextTick();
    if (logEl.value) logEl.value.scrollTop = logEl.value.scrollHeight;
  }
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

// ---------- 目录 ----------
async function loadSettings() {
  try {
    const r = await fetch('/api/settings');
    const s = await r.json();
    const d = s.defaults && s.defaults.tiktok;
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
      body: JSON.stringify({ tool: 'tiktok', dir: d }),
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
    const data = await r.json();
    if (!data.ok) {
      ElMessage.warning('无法打开目录：' + data.message);
      log('无法打开目录：' + data.message, 'err');
    }
  } catch {
    ElMessage.warning('无法打开目录：连接服务失败');
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
    if (confirm(`是否将「${d}」设为默认目录？\n下次打开会自动使用该目录。`)) {
      await setDefaultDir(d);
    }
  }
  downloading.value = true;
  showVpn.value = false;
  logLines.value = [];
  summary.value = { show: false, text: '', color: '' };

  log(`开始任务：共 ${list.length} 个链接`, 'title', '任务');
  let networkIssue = false;
  progress.value = { show: true, done: 0, ok: 0, fail: 0, total: list.length };

  try {
    const resp = await fetch('/api/download', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ urls: list.join('\n'), dir: d }),
    });
    if (!resp.ok || !resp.body) {
      const err = await resp.json().catch(() => ({}));
      log(err.message || '请求失败', 'err');
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
        handleEvent(ev);
        if (ev.network) networkIssue = true;
      }
    }
  } catch (e) {
    log('连接服务失败：' + e.message, 'err');
  } finally {
    downloading.value = false;
  }

  if (networkIssue) showVpn.value = true;
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
    <div class="header">
      <div class="logo">TT</div>
      <div>
        <h1>TikTok 无水印视频批量下载工具</h1>
        <p>支持批量输入多个视频链接 · 以视频 ID 命名 · 自动跳过失效链接</p>
      </div>
    </div>

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
        <template #header>
          <span class="step-num">1</span> 输入 TikTok 视频链接
        </template>
        <el-input
          v-model="urls"
          type="textarea"
          :rows="8"
          placeholder="每行粘贴一个 TikTok 视频链接，例如：&#10;https://www.tiktok.com/@username/video/7439702365055290666&#10;&#10;支持 www.tiktok.com / vm.tiktok.com / v.tiktok.com 短链接"
        />
        <div class="empty-hint">{{ validCount ? `已识别 ${validCount} 个有效链接` : '' }}</div>
      </el-card>

      <el-card shadow="never" class="card">
        <template #header>
          <span class="step-num">2</span> 选择保存位置
        </template>
        <div class="dir-row">
          <el-input v-model="dir" placeholder="例如 D:\videos\tiktok" class="dir-field">
            <template #prepend>保存目录（不存在将自动创建）</template>
          </el-input>
          <el-button @click="dirPickerVisible = true">浏览</el-button>
          <el-button @click="setDefaultDir(dir)">设为默认目录</el-button>
          <el-button @click="openDir">打开目录</el-button>
        </div>
        <div class="actions">
          <el-button type="primary" size="large" :loading="downloading" @click="startDownload">
            {{ downloading ? '下载中...' : '开始下载' }}
          </el-button>
          <el-button size="large" @click="recheckNetwork">重新检测网络</el-button>
        </div>
      </el-card>

      <el-card shadow="never" class="card">
        <template #header>
          <span class="step-num">3</span> 下载日志
        </template>
        <div v-if="progress.show" class="progress-line">
          进度：{{ progress.done }} / {{ progress.total }}
          <span class="ok">成功 {{ progress.ok }}</span>
          <span class="err">失败 {{ progress.fail }}</span>
        </div>
        <el-alert v-if="summary.show" :closable="false" :style="{ color: summary.color }" :title="summary.text" class="summary-alert" />
        <div ref="logEl" class="log">
          <div v-for="(l, i) in logLines" :key="i" class="log-line">
            <span class="log-time">{{ l.time }}</span>
            <span class="log-text" :class="'log-' + l.cls">{{ l.title ? `[${l.title}] ` : '' }}{{ l.message }}</span>
          </div>
        </div>
      </el-card>

      <div class="footer">提示：下载失败的网络错误通常需要开启 VPN 后重试；单个链接失效或受限会自动跳过，不影响其他视频。</div>
    </div>

    <DirPicker v-model="dirPickerVisible" @select="(v) => (dir = v)" />
  </div>
</template>

<style scoped>
.page {
  font-family: "Microsoft YaHei", "PingFang SC", -apple-system, "Segoe UI", sans-serif;
  background: #f5f6fa;
  color: #23262f;
  min-height: 100vh;
}
.header {
  background: linear-gradient(135deg, #000000 0%, #1a1a2e 100%);
  color: #fff;
  padding: 28px 40px;
  display: flex;
  align-items: center;
  gap: 16px;
}
.logo {
  width: 44px;
  height: 44px;
  background: #fe2c55;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 22px;
  font-weight: 700;
  box-shadow: 0 4px 14px rgba(254, 44, 85, 0.4);
}
.header h1 { font-size: 20px; font-weight: 600; }
.header p { font-size: 13px; opacity: 0.7; margin-top: 2px; }
.container { max-width: 900px; margin: 28px auto; padding: 0 20px 60px; }
.card { margin-bottom: 20px; border-radius: 14px; }
.step-num {
  background: #fe2c55;
  color: #fff;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  font-size: 12px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  margin-right: 8px;
}
.proxy-on { margin-bottom: 20px; }
.proxy-off { margin-bottom: 20px; }
.dot {
  display: inline-block;
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: #25c16d;
  margin-right: 8px;
}
.dot.off { background: #f5a623; }
.vpn-alert { margin-bottom: 20px; }
.empty-hint { color: #767b8a; font-size: 12.5px; margin-top: 8px; }
.dir-row { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
.dir-field { flex: 1; min-width: 260px; }
.actions { display: flex; gap: 10px; margin-top: 18px; }
.progress-line {
  font-size: 13.5px;
  font-weight: 600;
  margin-bottom: 12px;
}
.progress-line .ok { color: #25c16d; }
.progress-line .err { color: #e5484d; }
.summary-alert { margin-bottom: 12px; }
.log {
  max-height: 420px;
  overflow-y: auto;
  background: #10131c;
  border-radius: 10px;
  padding: 14px 16px;
  font-family: Consolas, "Courier New", monospace;
  font-size: 12.5px;
  line-height: 1.8;
}
.log-line { display: flex; gap: 8px; word-break: break-all; }
.log-line + .log-line { margin-top: 3px; }
.log-time { color: #5c6370; flex-shrink: 0; }
.log-info { color: #b8c0cc; }
.log-warn { color: #ffc95c; }
.log-ok { color: #5fd08a; }
.log-err { color: #ff7b72; }
.log-network { color: #ff9d5c; font-weight: 600; }
.log-title { color: #7d8aff; font-weight: 600; }
.footer {
  text-align: center;
  color: #767b8a;
  font-size: 12px;
  padding: 20px 0 30px;
}
</style>