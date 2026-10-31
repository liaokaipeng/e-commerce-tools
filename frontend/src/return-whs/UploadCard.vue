<!-- 获取退单仓库 · ② 上传表格卡：拖拽上传（.xlsx / .xls / .csv）+ 文件元信息 + 未授权店铺警告。
     表格解析状态由页面（useReturnTable / App.vue）持有，本组件只负责选择文件与展示。 -->
<script setup>
import { ref } from 'vue';
import { UploadFilled } from '@element-plus/icons-vue';
import StepCard from '../components/StepCard.vue';

defineProps({
  /** 解析结果 { fileName, rows, skipped, skippedNoShop } */
  table: { type: Object, default: null },
  /** 表格涉及的店铺ID（去重） */
  tableShopIds: { type: Array, default: () => [] },
  /** 表中未授权 / 已失效的店铺ID（非空时禁执行并提示） */
  badShopIds: { type: Array, default: () => [] },
});

const emit = defineEmits(['file-change', 'file-remove']);

// el-upload 组件实例（超限替换文件时同步界面文件列表用）
const uploadRef = ref(null);

// 已选 1 个文件时再次选择：替换为新文件并同步界面文件列表（对齐 video 页写法，避免列表停留在旧文件）
function onFileExceed(files) {
  uploadRef.value?.clearFiles();
  uploadRef.value?.handleStart(files[0]);
  emit('file-change', files[0]);
}
</script>

<template>
  <StepCard :index="2" title="上传表格">
    <template #extra>
      <el-tag size="small" effect="light">支持 .xlsx / .xls / .csv</el-tag>
    </template>
    <el-upload
      ref="uploadRef"
      class="file-upload"
      drag
      action="#"
      :auto-upload="false"
      :limit="1"
      accept=".xlsx,.xls,.csv"
      :on-change="(f) => emit('file-change', f)"
      :on-exceed="onFileExceed"
      :on-remove="() => emit('file-remove')"
    >
      <el-icon class="el-icon--upload"><upload-filled /></el-icon>
      <div class="el-upload__text">把表格文件拖到这里，或 <em>点击选择文件</em></div>
      <template #tip>
        <div class="el-upload__tip">表头第 1 行必须包含 <b>Return ID</b> 列、<b>Order ID</b> 列与 <b>店铺ID</b> 列（也识别「退货ID / 退单编号 / 订单编号 / Shop ID / 店铺编号」等写法）。每行按自己的店铺ID查询，可一次混排多个店铺。</div>
      </template>
    </el-upload>
    <div v-if="table" class="table-meta">
      文件：{{ table.fileName || '（未命名）' }} ｜ 待查询 {{ table.rows.length }} 行（{{ tableShopIds.length }} 个店铺）
      <span v-if="table.skipped">（跳过 {{ table.skipped }} 行无 Return ID）</span>
      <span v-if="table.skippedNoShop">（跳过 {{ table.skippedNoShop }} 行无店铺ID）</span>
    </div>
    <el-alert
      v-if="badShopIds.length"
      class="shop-alert"
      type="warning"
      :closable="false"
      show-icon
      :title="`表格中有未授权或已失效的店铺ID：${badShopIds.join('、')}`"
      description="请先到「开放平台」页完成授权或重新授权后再执行。"
    />
  </StepCard>
</template>

<style scoped>
.file-upload { margin-top: var(--sp-1); }
.table-meta { margin-top: var(--sp-3); font-size: var(--fs-sm); color: var(--text-2); }
.shop-alert { margin-top: var(--sp-3); }
</style>
