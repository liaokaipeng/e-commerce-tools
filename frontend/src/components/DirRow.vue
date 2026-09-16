<!-- 目录行：目录输入 + 浏览 / 设为默认目录 / 打开目录
     （tiktok / bidding 用作「保存目录」，compress 页用作「源文件夹」，故标签可由 label 覆盖） -->
<script setup>
import { ref } from 'vue';
import DirPicker from './DirPicker.vue';

defineProps({
  dir: { type: String, default: '' },
  placeholder: { type: String, default: '例如 D:\\videos' },
  /** 输入框前缀文案（留空取默认的「保存目录」口径） */
  label: { type: String, default: '保存目录（不存在将自动创建）' },
  /** 「设为默认目录」按钮文案 */
  rememberText: { type: String, default: '设为默认目录' },
  /** 是否显示「设为默认目录」按钮（压缩页不记住文件夹，传 false） */
  showRemember: { type: Boolean, default: true },
});
const emit = defineEmits(['update:dir', 'set-default', 'open']);

const visible = ref(false);

function setDir(v) {
  emit('update:dir', v);
}
</script>

<template>
  <div class="dir-row">
    <el-input
      :model-value="dir"
      class="dir-field"
      :placeholder="placeholder"
      @update:model-value="setDir"
    >
      <template #prepend>{{ label }}</template>
    </el-input>
    <el-button @click="visible = true">浏览</el-button>
    <el-button v-if="showRemember" @click="emit('set-default', dir)">{{ rememberText }}</el-button>
    <el-button @click="emit('open')">打开目录</el-button>
  </div>
  <DirPicker v-model="visible" @select="setDir" />
</template>

<style scoped>
.dir-row {
  display: flex;
  gap: 10px;
  align-items: center;
  flex-wrap: wrap;
}
.dir-field {
  flex: 1;
  min-width: 260px;
}
</style>
