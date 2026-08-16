<!-- 保存目录行：目录输入 + 浏览 / 设为默认目录 / 打开目录（tiktok / bidding 共用） -->
<script setup>
import { ref } from 'vue';
import DirPicker from './DirPicker.vue';

const props = defineProps({
  dir: { type: String, default: '' },
  hasDefault: { type: Boolean, default: false },
  placeholder: { type: String, default: '例如 D:\\videos' },
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
      <template #prepend>保存目录（不存在将自动创建）</template>
    </el-input>
    <el-button @click="visible = true">浏览</el-button>
    <el-button @click="emit('set-default', dir)">设为默认目录</el-button>
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
