<!-- TikTok 无水印下载页：编排网络检测与下载任务，模板与样式见下。 -->
<script setup>
import { onMounted } from 'vue';
import DirRow from '../components/DirRow.vue';
import LogPanel from '../components/LogPanel.vue';
import { useDirSettings } from '../composables/useDirSettings.js';
import { useLog } from '../composables/useLog.js';
import { useTiktokNetwork } from './useTiktokNetwork.js';
import { useDownloadJob } from './useDownloadJob.js';

const { logLines, log, clear: clearLog } = useLog();

const { dir, hasDefault, loadSettings, setDefaultDir, openDir } = useDirSettings('tiktok', log);

const { proxyConnected, proxyText, showVpn, checkNetwork, recheckNetwork } = useTiktokNetwork({
  log,
  onStatus: (data) => {
    if (data.defaultDir && !dir.value) dir.value = data.defaultDir;
  },
});

const { urls, downloading, progress, progressPct, summary, validCount, startDownload, stopDownload } =
  useDownloadJob({ dir, hasDefault, setDefaultDir, log, clear: clearLog, showVpn });

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
