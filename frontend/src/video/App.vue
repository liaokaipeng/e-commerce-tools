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
const {
  site, isPh, siteLabel,
  auth, cookie, shopId, userid, refreshingCreds,
  selectedShopId, shopOptions, shopEmptyTip,
  applyShop, refreshCreds, assertReady,
} = creds;
useVideoPageLifecycle(creds);

const { rows, parseFile, downloadTemplate, exportResult } = useVideoTable();
const pendingFile = ref(null);
// el-upload 实例的 function-ref 出口，不参与渲染，无需响应式包装
let uploadWidget = null;

function onFileChange(uploadFile) {
  if (!uploadFile) return;
  pendingFile.value = uploadFile.raw || null;
}

function onFileExceed(files) {
  // 已选 1 个文件时再次选择：替换为新文件
  uploadWidget?.clearFiles();
  pendingFile.value = files[0] || null;
  uploadWidget?.handleStart(files[0]);
}

function onFileRemove() {
  pendingFile.value = null;
}

const { logLines, clearLog, autoScroll, uploading, summary, currentJobId, startUpload, cancelUpload } =
  useVideoUpload({
    site, isPh, siteLabel,
    // 任务结束（完成/取消）后自动导出带【状态】列的结果表格
    onFinish: () => exportResult(),
  });

function onStart() {
  startUpload(
    rows.value,
    { auth: auth.value, cookie: cookie.value, shopId: shopId.value, userid: userid.value },
    assertReady
  );
}
</script>

<template>
  <div class="page">
    <div class="container">
      <VideoSteps
        :is-ph="isPh"
        :refreshing-creds="refreshingCreds"
        :shop-options="shopOptions"
        :shop-empty-tip="shopEmptyTip"
        :selected-shop-id="selectedShopId"
        :userid="userid"
        :rows="rows"
        :upload-ref="uploadWidget"
        @refresh-creds="refreshCreds"
        v-model:selected-shop-id="selectedShopId"
        v-model:userid="userid"
        @apply-shop="applyShop"
        @update:upload-ref="(v) => { uploadWidget = v; }"
        @file-change="onFileChange"
        @file-exceed="onFileExceed"
        @file-remove="onFileRemove"
        @parse="() => parseFile(pendingFile)"
        @download-template="downloadTemplate"
      />

      <VideoUploadPanel
        :has-rows="rows.length > 0"
        :uploading="uploading"
        :current-job-id="currentJobId"
        :summary="summary"
        v-model:auto-scroll="autoScroll"
        :log-lines="logLines"
        @start="onStart"
        @cancel="cancelUpload"
        @clear-log="clearLog"
        @export-result="exportResult"
      />
    </div>
  </div>
</template>
