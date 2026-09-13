<script setup>
// 版本与更新抽屉：展示更新检查结果与一键更新 SSE 进度。
const updateDrawer = defineModel('updateDrawer', { type: Boolean });

defineProps({
  ver: { type: Object, default: () => ({}) },
  upd: { type: Object, default: () => ({}) },
  checking: { type: Boolean, default: false },
  applying: { type: Boolean, default: false },
  steps: { type: Array, default: () => [] },
  doneInfo: { type: Object, default: null },
});

const emit = defineEmits(['check', 'apply', 'download']);

function fmtTime(iso) {
  if (!iso) return '';
  return String(iso).slice(0, 19).replace('T', ' ');
}
</script>

<template>
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
        <el-button :loading="checking" :disabled="applying" @click="emit('check')">检查更新</el-button>
        <el-button
          type="primary"
          :loading="applying"
          :disabled="!upd.hasUpdate || !upd.configured"
          @click="emit('apply')"
        >一键更新</el-button>
        <el-button link :disabled="!upd.url" @click="emit('download')">下载安装包</el-button>
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
</template>

<style scoped>
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
</style>
