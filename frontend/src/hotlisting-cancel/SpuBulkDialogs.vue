<!-- Shopee 取消注册 Hot Listing · 批量导入 / 导出弹窗：解析与文本生成在 spu-text.js（纯函数），
     弹窗打开由配置卡片工具条经父组件调用 openImport / openExport；导入结果的写回上抛给 App。 -->
<script setup>
import { ref, computed } from 'vue';
import { ElMessage } from 'element-plus';
import { copyText } from '../utils/clipboard.js';
import { parseBulkSpuText, buildBulkSpuExport } from './spu-text.js';

const props = defineProps({
  stores: { type: Array, default: () => [] },
  spuMap: { type: Object, default: () => ({}) },
});

const emit = defineEmits(['apply']);

const importVisible = ref(false);
const importText = ref('');
const exportVisible = ref(false);
const exportText = ref('');
const exportCount = ref(0);

const importParsed = computed(() => parseBulkSpuText(importText.value, props.stores));

function openImport() {
  importText.value = '';
  importVisible.value = true;
}

function openExport() {
  const { count, text } = buildBulkSpuExport(props.spuMap, props.stores);
  exportCount.value = count;
  exportText.value = text;
  exportVisible.value = true;
}

function applyImport() {
  const { items, unmatched } = importParsed.value;
  if (!items.length) { ElMessage.warning('没有解析出有效记录，请检查格式'); return; }
  importVisible.value = false;
  emit('apply', { items, unmatched });
}

async function copyExport() {
  if (await copyText(exportText.value)) ElMessage.success('已复制到剪贴板');
  else ElMessage.warning('复制失败，请手动全选复制');
}

defineExpose({ openImport, openExport });
</script>

<template>
  <!-- 批量导入：直接从 Excel 粘两列（店铺ID 或 店铺名 + SPU） -->
  <el-dialog v-model="importVisible" title="批量导入 SPU 配置" width="620px">
    <div class="dlg-tip">
      从 Excel 直接粘贴两列：<b>店铺ID（或店铺名）</b> + <b>SPU ID</b>，每行一条，用 Tab / 逗号分隔。例如
      <code>123456789&nbsp;&nbsp;42555837160</code> 或 <code>深圳3C数码旗舰店,42555837160</code>。
    </div>
    <el-input v-model="importText" type="textarea" :rows="10" placeholder="每行一条：店铺ID 或 店铺名 + SPU ID" />
    <div class="dlg-preview">
      <template v-if="importText.trim()">
        识别到 <b>{{ importParsed.items.length }}</b> 条有效记录<template v-if="importParsed.unmatched.length">，
        <span class="warn">{{ importParsed.unmatched.length }} 行无法识别</span></template>
        <div v-for="it in importParsed.items.slice(0, 5)" :key="it.id" class="dlg-item">
          {{ it.name || '（无名称）' }}（{{ it.id }}）→ {{ it.spu }}
        </div>
        <div v-if="importParsed.items.length > 5" class="dlg-item">…等共 {{ importParsed.items.length }} 条</div>
      </template>
    </div>
    <template #footer>
      <el-button @click="importVisible = false">取消</el-button>
      <el-button type="primary" :disabled="importParsed.items.length === 0" @click="applyImport">导入并保存</el-button>
    </template>
  </el-dialog>

  <!-- 导出：把当前全量配置输出成「店铺ID / SPU / 店铺名」，可粘回 Excel 或修改后再导入 -->
  <el-dialog v-model="exportVisible" title="导出当前 SPU 配置" width="620px">
    <div class="dlg-tip">共 {{ exportCount }} 个店铺有配置，可直接复制到 Excel 存档；改完再用「批量导入」贴回来。</div>
    <el-input v-model="exportText" type="textarea" :rows="10" readonly />
    <template #footer>
      <el-button @click="exportVisible = false">关闭</el-button>
      <el-button type="primary" @click="copyExport">复制到剪贴板</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
/* 批量导入 / 导出弹窗 */
.dlg-tip { font-size: var(--fs-sm); color: var(--text-2); line-height: 1.8; margin-bottom: var(--sp-2); }
.dlg-tip code { font-family: var(--font-mono); background: var(--surface-2); padding: 1px 4px; border-radius: 3px; }
.dlg-preview { margin-top: var(--sp-2); min-height: 20px; font-size: var(--fs-xs); color: var(--text-3); line-height: 1.8; }
.dlg-preview .warn { color: var(--warning); }
.dlg-item { font-family: var(--font-mono); color: var(--text-2); }
</style>
