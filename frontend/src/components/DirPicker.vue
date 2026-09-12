<!-- 目录选择对话框（浏览本地文件夹），重写自原 public/common/dirpicker.js -->
<script setup>
import { ref, watch } from 'vue';
import { ElMessage } from 'element-plus';

const props = defineProps({
  modelValue: { type: Boolean, default: false },
});
const emit = defineEmits(['update:modelValue', 'select']);

const loading = ref(false);
const currentPath = ref(null); // null 表示盘符列表
const parentPath = ref(null);
const dirs = ref([]);
const error = ref('');

async function load(p) {
  loading.value = true;
  error.value = '';
  const q = p ? '?path=' + encodeURIComponent(p) : '';
  try {
    const r = await fetch('/api/browse' + q);
    const d = await r.json();
    if (!d.ok) {
      error.value = '无法访问：' + (d.message || '未知错误');
      dirs.value = [];
      return;
    }
    currentPath.value = d.current;
    parentPath.value = d.parent;
    dirs.value = d.dirs;
  } catch (e) {
    error.value = '无法连接服务';
    dirs.value = [];
  } finally {
    loading.value = false;
  }
}

function goUp() {
  if (parentPath.value) load(parentPath.value);
}

function enter(d) {
  load(d.path);
}

function confirm() {
  if (!currentPath.value) {
    ElMessage.warning('请先进入一个目录');
    return;
  }
  const dir = currentPath.value;
  emit('update:modelValue', false);
  emit('select', dir);
}

watch(
  () => props.modelValue,
  (v) => {
    if (v) load(null);
  }
);
</script>

<template>
  <el-dialog
    :model-value="modelValue"
    title="选择保存目录"
    width="560px"
    :close-on-click-modal="false"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <div class="dp-current">{{ currentPath ? '当前目录：' + currentPath : '请选择磁盘' }}</div>
    <el-alert v-if="error" :title="error" type="error" :closable="false" show-icon class="dp-error" />
    <div v-loading="loading" class="dp-list">
      <div v-if="parentPath" class="dp-row" @click="goUp"><span class="dp-ico">↰</span><span>上级目录…</span></div>
      <template v-if="dirs.length">
        <div v-for="d in dirs" :key="d.path" class="dp-row" :title="d.path" @click="enter(d)">
          <span class="dp-ico">📁</span><span>{{ d.name }}</span>
        </div>
      </template>
      <div v-else-if="!loading && !error" class="dp-empty">（该目录下没有子文件夹）</div>
    </div>
    <template #footer>
      <el-button :disabled="!parentPath" @click="goUp">上级目录</el-button>
      <el-button @click="emit('update:modelValue', false)">取消</el-button>
      <el-button type="primary" @click="confirm">选择此目录</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.dp-current {
  font-size: var(--fs-xs);
  color: var(--text-3);
  word-break: break-all;
  margin-bottom: var(--sp-2);
}
.dp-error { margin-bottom: var(--sp-2); }
.dp-list {
  min-height: 220px;
  max-height: 260px;
  overflow-y: auto;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 6px 8px;
}
.dp-row {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  padding: 8px 10px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  font-size: var(--fs-sm);
  color: var(--text-1);
}
.dp-row:hover { background: var(--surface-2); }
.dp-ico { flex-shrink: 0; }
.dp-empty {
  color: var(--text-3);
  font-size: var(--fs-sm);
  padding: var(--sp-5);
  text-align: center;
}
</style>