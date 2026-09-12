<script setup>
// 视频批量上传页（跨境 / 本土共用，站点由 ?mode=cn|ph 固定）—— 页面编排层。
// 分工（与原 596 行单文件相比，按职责拆开）：
//   useVideoCreds.js  凭证：站点 / 本地缓存 / 服务端同步 / 跨境多店铺选择
//   useVideoTable.js  表格：列名匹配 / CSV·xlsx 解析 / 预览行校验 / 模板下载
//   useVideoUpload.js 上传：启动任务 / SSE 事件分流 / 进度 / 取消
//   VideoSteps.vue    展示：凭证卡片 + 表格卡片
//   VideoUploadPanel.vue 展示：执行卡片 + 日志面板
import { ref } from 'vue';
import { useVideoCreds, useVideoPageLifecycle } from './useVideoCreds.js';
import { useVideoTable } from './useVideoTable.js';
import { useVideoUpload } from './useVideoUpload.js';
import VideoSteps from './VideoSteps.vue';
import VideoUploadPanel from './VideoUploadPanel.vue';

const creds = useVideoCreds();
useVideoPageLifecycle(creds);

const table = useVideoTable();
const pendingFile = ref(null);
const uploadWidget = ref(null);

function onFileChange(uploadFile) {
  if (!uploadFile) return;
  pendingFile.value = uploadFile.raw || null;
}

function onFileExceed(files) {
  // 已选 1 个文件时再次选择：替换为新文件
  uploadWidget.value?.clearFiles();
  pendingFile.value = files[0] || null;
  uploadWidget.value?.handleStart(files[0]);
}

function onFileRemove() {
  pendingFile.value = null;
}

const upload = useVideoUpload({
  site: creds.site, isPh: creds.isPh, siteLabel: creds.siteLabel,
  // 任务结束（完成/取消）后自动导出带【状态】列的结果表格
  onFinish: () => table.exportResult(),
});

function onStart() {
  upload.startUpload(
    table.rows.value,
    { auth: creds.auth.value, cookie: creds.cookie.value, shopId: creds.shopId.value, userid: creds.userid.value },
    creds.assertReady
  );
}
</script>

<template>
  <div class="page">
    <div class="container">
      <VideoSteps
        :is-ph="creds.isPh.value"
        :refreshing-creds="creds.refreshingCreds.value"
        :shop-options="creds.shopOptions.value"
        :selected-shop-id="creds.selectedShopId.value"
        :userid="creds.userid.value"
        :rows="table.rows.value"
        :upload-ref="uploadWidget"
        @refresh-creds="creds.refreshCreds"
        @update:selected-shop-id="(v) => (creds.selectedShopId.value = v)"
        @update:userid="(v) => (creds.userid.value = v)"
        @apply-shop="creds.applyShop"
        @update:upload-ref="(v) => (uploadWidget = v)"
        @file-change="onFileChange"
        @file-exceed="onFileExceed"
        @file-remove="onFileRemove"
        @parse="() => table.parseFile(pendingFile)"
        @download-template="table.downloadTemplate"
      />

      <VideoUploadPanel
        :has-rows="table.rows.value.length > 0"
        :uploading="upload.uploading.value"
        :current-job-id="upload.currentJobId.value"
        :summary="upload.summary.value"
        v-model:auto-scroll="upload.autoScroll.value"
        :log-lines="upload.logLines.value"
        @start="onStart"
        @cancel="upload.cancelUpload"
        @clear-log="upload.clearLog"
        @export-result="table.exportResult"
      />
    </div>
  </div>
</template>
