<!-- TikTok 无水印下载页：编排网络检测与下载任务，展示统一走 PageHeader + StepCard + RunControl 骨架。 -->
<script setup>
import { onMounted } from 'vue';
import PageHeader from '../components/PageHeader.vue';
import StepCard from '../components/StepCard.vue';
import RunControl from '../components/RunControl.vue';
import DirRow from '../components/DirRow.vue';
import LogPanel from '../components/LogPanel.vue';
import { useDirSettings } from '../composables/useDirSettings.js';
import { useLog } from '../composables/useLog.js';
import { useTiktokNetwork } from './useTiktokNetwork.js';
import { useDownloadJob } from './useDownloadJob.js';

const { logLines, log, clear: clearLog } = useLog();

const { dir, loadSettings, setDefaultDir, ensureDefaultDir, openDir } = useDirSettings('tiktok', log);

const { proxyConnected, proxyText, showVpn, checkNetwork, recheckNetwork } = useTiktokNetwork({
  log,
  onStatus: (data) => {
    if (data.defaultDir && !dir.value) dir.value = data.defaultDir;
  },
});

const { urls, downloading, progress, summary, validCount, startDownload, stopDownload } =
  useDownloadJob({ dir, ensureDefaultDir, log, clear: clearLog, showVpn });

onMounted(() => {
  checkNetwork();
  loadSettings();
});
</script>

<template>
  <div class="page">
    <div class="container">
      <PageHeader title="视频下载" desc="粘贴 TikTok 链接批量下载无水印视频到本机目录" />

      <el-alert class="proxy-alert" :closable="false" type="info" show-icon>
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

      <StepCard :index="1" title="输入 TikTok 视频链接">
        <el-input
          v-model="urls"
          type="textarea"
          :rows="8"
          placeholder="每行粘贴一个 TikTok 视频链接，例如：&#10;https://www.tiktok.com/@username/video/7439702365055290666&#10;&#10;支持 www.tiktok.com / vm.tiktok.com / v.tiktok.com 短链接"
        />
        <div class="hint empty-hint">{{ validCount ? `已识别 ${validCount} 个有效链接` : '' }}</div>
      </StepCard>

      <StepCard :index="2" title="选择保存位置">
        <DirRow
          v-model:dir="dir"
          placeholder="例如 D:\videos\tiktok"
          @set-default="setDefaultDir"
          @open="openDir"
        />
        <RunControl
          class="run-area"
          action-text="开始下载"
          running-text="下载中…"
          :running="downloading"
          :can-run="validCount > 0 && !downloading"
          :pausable="false"
          :cancellable="false"
          :progress="downloading && progress.show ? { done: progress.done, total: progress.total, fail: progress.fail } : null"
          tip="下载逐条进行，保存到上方设置的目录；大陆网络需保持代理开启。"
        >
          <template #extra-actions>
            <el-button v-if="downloading" size="large" type="danger" plain @click="stopDownload">停止下载</el-button>
            <el-button size="large" @click="recheckNetwork">重新检测网络</el-button>
          </template>
        </RunControl>
      </StepCard>

      <StepCard :index="3" title="下载日志">
        <el-alert v-if="summary.show" :closable="false" :title="summary.text" class="summary-alert" :class="summary.failed ? 'sum-err' : 'sum-ok'" />
        <LogPanel :lines="logLines" height="420px" />
      </StepCard>
    </div>
  </div>
</template>

<style scoped>
.proxy-alert { margin-bottom: var(--sp-5); }
.dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--success-bright);
  margin-right: var(--sp-2);
}
.dot.off { background: var(--warning-bright); }
.empty-hint { margin-top: var(--sp-2); }
.run-area { margin-top: var(--sp-4); }
.summary-alert { margin-bottom: var(--sp-3); }
.summary-alert.sum-ok { color: var(--success); }
.summary-alert.sum-err { color: var(--danger); }
</style>
