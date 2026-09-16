// 压缩环境（ffmpeg）组合式函数：查可用性、一键下载安装、安装进度。
// 压缩依赖外部 ffmpeg，首次使用必须在页面上装一次；装完落到仓库根 bin/（gitignored）。
import { ref } from 'vue';
import { ElMessage } from 'element-plus';
import { getJson } from '../composables/api.js';
import { runSSE } from '../composables/useSSE.js';

export function useCompressEnv({ log }) {
  const loading = ref(true);
  const ready = ref(false);
  const version = ref('');
  const ffmpegPath = ref('');
  const binDir = ref('');
  const defaults = ref({});

  const installing = ref(false);
  const installPercent = ref(0);
  const installText = ref('');

  async function load() {
    loading.value = true;
    try {
      const j = await getJson('/api/compress/status');
      if (!j || !j.ffmpeg) {
        log('读取压缩环境失败', 'err');
        return;
      }
      ready.value = !!j.ffmpeg.ready;
      version.value = j.ffmpeg.version || '';
      ffmpegPath.value = j.ffmpeg.ffmpegPath || '';
      binDir.value = j.ffmpeg.binDir || '';
      defaults.value = j.defaults || {};
    } catch {
      log('读取压缩环境失败：连接服务失败', 'err');
    } finally {
      loading.value = false;
    }
  }

  /** 一键下载安装 ffmpeg（SSE 上报下载百分比） */
  async function install() {
    if (installing.value) return;
    installing.value = true;
    installPercent.value = 0;
    installText.value = '正在连接下载源…';
    log('开始下载 ffmpeg（约 180MB，只需一次）…', 'info');
    try {
      await runSSE('/api/compress/install-ffmpeg', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      }, (ev) => {
        if (ev.type === 'install') {
          if (ev.phase === 'source') installText.value = `正在从「${ev.name}」下载…`;
          else if (ev.phase === 'download') {
            installPercent.value = ev.percent == null ? 0 : ev.percent;
            installText.value = `正在从「${ev.name}」下载… ${installPercent.value}%`;
          } else if (ev.phase === 'extract') {
            installPercent.value = 100;
            installText.value = '正在解压并安装…';
          } else if (ev.phase === 'source-failed') {
            log(`下载源「${ev.name}」不可用（${ev.message}），换下一个…`, 'warn');
            installPercent.value = 0;
          } else if (ev.phase === 'done') {
            installText.value = '安装完成';
          }
          return;
        }
        if (ev.type === 'installed') {
          ready.value = true;
          version.value = ev.version || '';
          log(`✓ ffmpeg 安装完成（${ev.version}，来源：${ev.source}）`, 'ok');
          return;
        }
        if (ev.type === 'fatal') {
          log(ev.msg, 'err');
          ElMessage.error(ev.msg);
        }
      }, log);
    } catch (e) {
      log('安装失败：' + e.message, 'err');
    } finally {
      installing.value = false;
      await load();
    }
  }

  return {
    loading, ready, version, ffmpegPath, binDir, defaults,
    installing, installPercent, installText,
    load, install,
  };
}
