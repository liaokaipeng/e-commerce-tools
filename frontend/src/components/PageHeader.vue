<!-- 页头：工具名 + 一句话说明（全部工具页统一骨架的第一元素）。
     extra 插槽放页头右侧内容（如状态徽章、次要操作）。 -->
<script setup>
defineProps({
  title: { type: String, required: true },
  desc: { type: String, default: '' },
});
</script>

<template>
  <div class="page-header">
    <div class="page-header-main">
      <h1 class="page-header-title">{{ title }}</h1>
      <p v-if="desc" class="page-header-desc">{{ desc }}</p>
    </div>
    <div v-if="$slots.extra" class="page-header-extra"><slot name="extra" /></div>
  </div>
</template>

<style scoped>
.page-header {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: var(--sp-4);
  margin-bottom: var(--sp-4);
  padding: 0 2px;
}
.page-header-title {
  margin: 0;
  font-size: 20px;
  font-weight: 700;
  color: var(--text-1);
  line-height: 1.3;
}
.page-header-desc {
  margin: 3px 0 0;
  font-size: var(--fs-sm);
  color: var(--text-3);
}
.page-header-extra { flex: none; }
</style>
