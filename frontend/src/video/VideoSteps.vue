<!-- 视频上传 · ① 凭证卡片与 ② 表格卡片（展示层）。
     状态与逻辑在 video/useVideoCreds.js / useVideoTable.js，本组件只负责渲染与事件上抛。 -->
<script setup>
import { UploadFilled } from '@element-plus/icons-vue';

defineProps({
  isPh: { type: Boolean, default: false },
  refreshingCreds: { type: Boolean, default: false },
  /** 跨境多店铺下拉 */
  shopOptions: { type: Array, default: () => [] },
  selectedShopId: { type: String, default: '' },
  userid: { type: String, default: '' },
  /** 表格 */
  headers: { type: Array, default: () => [] },
  mapPath: { type: String, default: '' },
  mapCaption: { type: String, default: '' },
  mapProduct: { type: String, default: '' },
  showMapping: { type: Boolean, default: false },
  rows: { type: Array, default: () => [] },
  uploadRef: { type: Object, default: null },
});

const emit = defineEmits([
  'refresh-creds', 'update:selectedShopId', 'update:userid', 'apply-shop',
  'update:mapPath', 'update:mapCaption', 'update:mapProduct', 'mapping-change',
  'file-change', 'file-exceed', 'file-remove', 'parse', 'download-template',
]);

const STATUS_TAG = { wait: 'info', run: 'warning', ok: 'success', err: 'danger' };
const STATUS_TEXT = { run: '上传中', ok: '成功', err: '失败' };
const statusTag = (t) => STATUS_TAG[t] || 'info';
const statusText = (t) => STATUS_TEXT[t] || '等待';
</script>

<template>
  <!-- 凭证 -->
  <el-card shadow="never" class="card">
    <template #header><span>上传凭证</span></template>
    <div v-if="!isPh" class="row">
      <el-select
        :model-value="selectedShopId"
        style="min-width: 280px"
        placeholder="选择要发布到的店铺"
        @update:model-value="(v) => { emit('update:selectedShopId', v); emit('apply-shop', v); }"
      >
        <el-option v-for="o in shopOptions" :key="o.value" :value="o.value" :label="o.label" />
      </el-select>
    </div>
    <div v-if="isPh" class="row">
      <span class="field-label">User ID（本土上传需要，扩展会自动抓取，若为空请手动填写）</span>
      <el-input
        id="userid"
        :model-value="userid"
        style="max-width: 220px"
        placeholder="如 13469117809"
        @update:model-value="(v) => emit('update:userid', v)"
      />
    </div>
    <div class="btn-row" style="margin-top: 10px">
      <el-button :loading="refreshingCreds" @click="emit('refresh-creds')">从浏览器刷新凭证</el-button>
    </div>
  </el-card>

  <!-- 表格 -->
  <el-card shadow="never" class="card">
    <template #header>
      <span>① 选择表格</span>
      <el-tag size="small" effect="light" class="pill">支持 .xlsx / .xls / .csv</el-tag>
    </template>
    <el-upload
      :ref="(el) => emit('update:uploadRef', el)"
      class="file-upload"
      drag
      action="#"
      :auto-upload="false"
      :limit="1"
      accept=".xlsx,.xls,.csv"
      :on-change="(f) => emit('file-change', f)"
      :on-exceed="(f) => emit('file-exceed', f)"
      :on-remove="() => emit('file-remove')"
    >
      <el-icon class="el-icon--upload"><upload-filled /></el-icon>
      <div class="el-upload__text">把表格文件拖到这里，或 <em>点击选择文件</em></div>
      <template #tip>
        <div class="el-upload__tip">
          表头需包含：<b>视频路径</b>、<b>视频说明</b>、<b>商品编码</b>；如列名不同，可在下方手动映射。
        </div>
      </template>
    </el-upload>

    <div v-if="showMapping" class="mapping">
      <div class="grid3">
        <div>
          <label>视频路径列</label>
          <el-select :model-value="mapPath" @update:model-value="(v) => { emit('update:mapPath', v); emit('mapping-change'); }">
            <el-option v-for="h in headers" :key="h" :value="h" :label="h || '(空)'" />
          </el-select>
        </div>
        <div>
          <label>视频说明列</label>
          <el-select :model-value="mapCaption" @update:model-value="(v) => { emit('update:mapCaption', v); emit('mapping-change'); }">
            <el-option v-for="h in headers" :key="h" :value="h" :label="h || '(空)'" />
          </el-select>
        </div>
        <div>
          <label>商品编码列</label>
          <el-select :model-value="mapProduct" @update:model-value="(v) => { emit('update:mapProduct', v); emit('mapping-change'); }">
            <el-option v-for="h in headers" :key="h" :value="h" :label="h || '(空)'" />
          </el-select>
        </div>
      </div>
    </div>

    <div class="btn-row">
      <el-button type="primary" @click="emit('parse')">解析表格</el-button>
      <el-button @click="emit('download-template')">下载 xlsx 模板</el-button>
    </div>

    <div v-if="rows.length" class="preview">
      <el-table :data="rows" size="small" max-height="320" border>
        <el-table-column type="index" label="#" width="50" />
        <el-table-column prop="path" label="视频路径" min-width="200" show-overflow-tooltip />
        <el-table-column prop="caption" label="视频说明" min-width="140" show-overflow-tooltip />
        <el-table-column prop="product" label="商品编码" min-width="120" />
        <el-table-column label="状态" width="100">
          <template #default="{ row }">
            <el-tag v-if="row.error" type="danger" size="small" :title="row.error">{{ row.error }}</el-tag>
            <el-tag v-else :type="statusTag(row.status)" size="small">{{ statusText(row.status) }}</el-tag>
          </template>
        </el-table-column>
      </el-table>
    </div>
  </el-card>
</template>

<style scoped>
.pill { margin-left: 8px; }
.file-upload { margin-top: 4px; }
.field-label { font-size: 12px; color: #6b7280; margin-right: 8px; }
.btn-row { display: flex; gap: 12px; margin-top: 6px; flex-wrap: wrap; align-items: center; }
.mapping { margin-top: 14px; }
.grid3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px; }
@media (max-width: 720px) {
  .grid3 { grid-template-columns: 1fr; }
}
.grid3 label { display: block; font-size: 12px; color: #6b7280; margin: 0 0 4px; }
.preview { margin-top: 14px; }
</style>
