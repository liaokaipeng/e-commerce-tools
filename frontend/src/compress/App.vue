<!-- 视频压缩页：选一个文件夹 → 递归找出所有视频 → 逐个压到体积与时长上限内。 -->
<script setup>
import { ref, computed, onMounted, watch } from 'vue';
import DirRow from '../components/DirRow.vue';
import LogPanel from '../components/LogPanel.vue';
import { useDirSettings } from '../composables/useDirSettings.js';
import { useLog } from '../composables/useLog.js';
import { useCompressEnv } from './useCompressEnv.js';
import { useCompressJob } from './useCompressJob.js';
import { formatBytes, formatDuration, ROW_TAG, ROW_TEXT } from './compress-format.js';

const { logLines, log, clear: clearLog } = useLog();
const env = useCompressEnv({ log });
const { dir, loadSettings, setDefaultDir, openDir, openPath } = useDirSettings('compress', log);

const job = useCompressJob({ log });

// 源文件夹（dir 复用「默认目录」持久化：下次打开自动回显上次用的文件夹）
const outDir = ref('');
// 压缩目标（默认值取自后端，保证与后端 DEFAULTS 单一来源）
const maxMB = ref(30);
const maxSeconds = ref(60);
const overMode = ref('trim');
const maxLongSide = ref(1280);

const SIDE_OPTIONS = [
  { value: 0, label: '不缩放（保持原分辨率）' },
  { value: 720, label: '720p（长边 720）' },
  { value: 1080, label: '1080p（长边 1080）' },
  { value: 1280, label: '1280（长边 1280，推荐）' },
  { value: 1920, label: '1920（长边 1920）' },
];

const opts = computed(() => ({
  maxMB: maxMB.value,
  maxSeconds: maxSeconds.value,
  overMode: overMode.value,
  maxLongSide: maxLongSide.value,
}));

const canScan = computed(() => !!dir.value.trim() && !job.scanning.value && !job.running.value);
const canRun = computed(() => env.ready.value && job.rows.value.length > 0 && !job.running.value);

/** 实际输出目录（展示用；留空即「源文件夹/compressed」） */
const effectiveOutDir = computed(
  () => outDir.value.trim() || `${dir.value.trim().replace(/[\\/]+$/, '')}\\${env.defaults.value.outSubdir || 'compressed'}`,
);

onMounted(async () => {
  await env.load();
  if (env.defaults.value.maxMB) maxMB.value = env.defaults.value.maxMB;
  if (env.defaults.value.maxSeconds) maxSeconds.value = env.defaults.value.maxSeconds;
  if (env.defaults.value.overMode) overMode.value = env.defaults.value.overMode;
  if (env.defaults.value.maxLongSide !== undefined) maxLongSide.value = env.defaults.value.maxLongSide;
  await loadSettings();
});

// 换文件夹后旧的扫描结果就不再对应，直接清掉，避免「拿 A 的列表压 B」
watch(() => dir.value, () => {
  if (job.rows.value.length && !job.running.value) {
    job.rows.value = [];
    job.scanned.value = false;
  }
});

function doScan() {
  clearLog();
  job.scan(dir.value.trim());
}

function doRun() {
  job.start({ dir: dir.value.trim(), outDir: outDir.value.trim(), opts: opts.value });
}
</script>

<template>
  <div class="page">
    <div class="container">
      <el-alert v-if="!env.loading.value && !env.ready.value" class="gap" type="warning" :closable="false" show-icon>
        <template #title>
          <b>未检测到 ffmpeg</b>——压缩由 ffmpeg 完成，需要先安装一次（约 180MB，只需一次，装在
          <code>{{ env.binDir.value || 'bin' }}</code> 下，之后不会随程序更新被覆盖）。
        </template>
        <div class="env-actions">
          <el-button type="primary" :loading="env.installing.value" @click="env.install()">
            {{ env.installing.value ? '正在下载安装…' : '下载并安装 ffmpeg' }}
          </el-button>
          <el-button @click="env.load()">重新检测</el-button>
        </div>
        <el-progress
          v-if="env.installing.value"
          class="env-progress"
          :percentage="env.installPercent.value"
          :stroke-width="10"
        />
        <div v-if="env.installing.value" class="hint">{{ env.installText.value }}</div>
        <div class="hint">
          也可以自行下载 ffmpeg 后，把 <code>ffmpeg.exe</code> 与 <code>ffprobe.exe</code>
          放进上面这个目录，再点「重新检测」。
        </div>
      </el-alert>

      <el-alert v-else-if="!env.loading.value" class="gap" type="success" :closable="false" show-icon>
        <template #title>
          ffmpeg 已就绪（{{ env.version.value || '版本未知' }}）——压缩在本机完成，不上传任何文件。
        </template>
      </el-alert>

      <el-card shadow="never" class="card">
        <template #header>① 选择要压缩的文件夹</template>
        <DirRow
          v-model:dir="dir"
          label="源文件夹（必须已存在）"
          remember-text="记住此文件夹"
          placeholder="例如 D:\videos\待压缩"
          @set-default="setDefaultDir"
          @open="openDir"
        />
        <div class="dir-row out-row">
          <el-input v-model="outDir" class="dir-field" placeholder="留空 = 源文件夹下的 compressed 子目录">
            <template #prepend>输出目录（可选）</template>
          </el-input>
          <el-button @click="openPath(effectiveOutDir, '请先选择源文件夹')">打开输出目录</el-button>
        </div>
        <div class="hint">
          会递归处理该文件夹下所有子目录里的视频；原文件不会被改动或删除，
          压缩结果按原有的子目录结构写到「{{ effectiveOutDir }}」，文件名加 <code>_compressed</code> 后缀。
        </div>
      </el-card>

      <el-card shadow="never" class="card">
        <template #header>② 压缩目标</template>
        <div class="opt-grid">
          <div class="opt">
            <label>单个文件体积上限</label>
            <el-input-number v-model="maxMB" :min="1" :max="4096" :step="5" />
            <span class="unit">MB</span>
          </div>
          <div class="opt">
            <label>单个文件时长上限</label>
            <el-input-number v-model="maxSeconds" :min="1" :max="3600" :step="10" />
            <span class="unit">秒</span>
          </div>
          <div class="opt wide">
            <label>超过时长上限时怎么处理</label>
            <el-radio-group v-model="overMode">
              <el-radio-button value="trim">截取前 {{ maxSeconds }} 秒</el-radio-button>
              <el-radio-button value="speed">整段加速到 {{ maxSeconds }} 秒</el-radio-button>
            </el-radio-group>
          </div>
          <div class="opt wide">
            <label>分辨率上限</label>
            <el-select v-model="maxLongSide" class="side-select">
              <el-option v-for="o in SIDE_OPTIONS" :key="o.value" :label="o.label" :value="o.value" />
            </el-select>
          </div>
        </div>
        <div class="hint">
          已经同时满足「体积 ≤ {{ maxMB }}MB 且时长 ≤ {{ maxSeconds }} 秒」的视频会被自动跳过，不做二次压缩（避免画质白白损失）。
        </div>
      </el-card>

      <el-card shadow="never" class="card">
        <template #header>
          <div class="card-header-row">
            <span>③ 扫描与执行</span>
            <span v-if="job.rows.value.length" class="sel-count">
              共 {{ job.rows.value.length }} 个 · 合计 {{ formatBytes(job.totalSize.value) }}
              <span :class="job.overSizeCount.value ? 'cnt-bad' : 'cnt-ok'">
                · 超上限 {{ job.overSizeCount.value }} 个
              </span>
            </span>
          </div>
        </template>

        <div class="actions exec-actions">
          <el-button :disabled="!canScan" :loading="job.scanning.value" @click="doScan">扫描文件夹</el-button>
          <template v-if="job.running.value">
            <el-button type="primary" :loading="true">压缩中…</el-button>
            <el-button :disabled="job.pausing.value" @click="job.togglePause()">
              {{ job.paused.value ? '继续' : '暂停' }}
            </el-button>
            <el-button type="danger" @click="job.cancel()">取消</el-button>
            <span v-if="job.paused.value" class="paused-tip">已暂停：当前文件会先压完，再停在下个文件前。</span>
          </template>
          <el-button v-else type="primary" :disabled="!canRun" @click="doRun">开始压缩</el-button>
        </div>

        <div v-if="job.running.value || job.finished.value" class="progress-line">
          <el-progress :percentage="job.progressPct.value" :stroke-width="12" class="progress-bar" />
          <div class="progress-text">
            {{ job.progress.value.done }} / {{ job.progress.value.total }}
            <span class="ok">已压缩 {{ job.progress.value.ok }}</span>
            <span>跳过 {{ job.progress.value.skip }}</span>
            <span class="err">失败 {{ job.progress.value.fail }}</span>
            <span v-if="job.savedBytes.value > 0">省下 {{ formatBytes(job.savedBytes.value) }}</span>
          </div>
        </div>

        <el-table v-if="job.rows.value.length" :data="job.rows.value" size="small" max-height="360" class="preview-table">
          <el-table-column type="index" label="#" width="52" />
          <el-table-column prop="rel" label="相对路径" min-width="240" show-overflow-tooltip />
          <el-table-column label="原大小" width="100">
            <template #default="{ row }">{{ formatBytes(row.size) }}</template>
          </el-table-column>
          <el-table-column label="原时长" width="88">
            <template #default="{ row }">{{ row.duration ? formatDuration(row.duration) : '—' }}</template>
          </el-table-column>
          <el-table-column label="进度" width="90">
            <template #default="{ row }">
              <el-progress
                v-if="row.status === 'run'"
                :percentage="row.percent || 0"
                :stroke-width="8"
                :show-text="false"
              />
              <span v-else>{{ row.status === 'ok' || row.status === 'skip' ? 100 + '%' : '—' }}</span>
            </template>
          </el-table-column>
          <el-table-column label="状态" width="88">
            <template #default="{ row }">
              <el-tag :type="ROW_TAG[row.status] || 'info'" size="small">{{ ROW_TEXT[row.status] || '等待' }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="结果" min-width="240" show-overflow-tooltip>
            <template #default="{ row }">
              <span v-if="row.status === 'err'" class="row-err">{{ row.error }}</span>
              <span v-else class="row-detail">{{ row.detail }}</span>
            </template>
          </el-table-column>
        </el-table>
        <div v-else class="hint">
          先选择源文件夹再点「扫描文件夹」，这里会列出所有会被处理的视频。
        </div>

        <LogPanel class="log-box" :lines="logLines" height="320px" empty-text="等待操作…" />
      </el-card>
    </div>
  </div>
</template>

<style scoped>
.gap { margin-bottom: var(--sp-5); }
.env-actions { margin-top: var(--sp-3); display: flex; gap: 10px; flex-wrap: wrap; }
.env-actions :deep(.el-button + .el-button) { margin-left: 0; }
.env-progress { margin-top: var(--sp-3); max-width: 460px; }
/* DirRow 的 .dir-row / .dir-field 是它自己的 scoped 样式，不会作用到本页的元素上，
   所以这里的第二行目录需要自己声明 flex 布局，否则输入框会独占一行、按钮被挤到下一行。 */
.out-row {
  margin-top: var(--sp-3);
  display: flex;
  gap: 10px;
  align-items: center;
  flex-wrap: wrap;
}
.out-row .dir-field { flex: 1; min-width: 260px; }
.out-row :deep(.el-button + .el-button) { margin-left: 0; }
.opt-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: var(--sp-4);
}
.opt { display: flex; align-items: center; gap: var(--sp-2); flex-wrap: wrap; }
.opt.wide { grid-column: 1 / -1; }
.opt label { color: var(--text-2); font-size: var(--fs-sm); white-space: nowrap; }
.unit { color: var(--text-3); font-size: var(--fs-sm); }
.side-select { width: 260px; }
.exec-actions { margin-bottom: var(--sp-3); }
.progress-line {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
  margin-bottom: var(--sp-3);
  flex-wrap: wrap;
}
.progress-bar { flex: 1; min-width: 200px; }
.progress-text { font-size: var(--fs-sm); font-weight: 600; white-space: nowrap; }
.progress-text span { margin-left: var(--sp-3); font-weight: 400; color: var(--text-2); }
.progress-text .ok { color: var(--success); font-weight: 600; }
.progress-text .err { color: var(--danger); font-weight: 600; }
.row-detail { color: var(--text-3); font-size: var(--fs-xs); }
.row-err { color: var(--danger); font-size: var(--fs-xs); }
code {
  background: var(--surface-2);
  border-radius: 4px;
  padding: 0 4px;
  font-family: var(--font-mono);
  font-size: var(--fs-xs);
}
</style>
