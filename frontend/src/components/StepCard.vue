<!-- 步骤卡：统一「编号圆点 + 标题 + 右侧徽章/操作」的卡片头（替代各页 ①②③ 手写编号）。
     index 传数字或空串（无编号卡）；badge 是右侧状态徽章（自动右对齐）；
     extra 插槽放头部右侧的其他内容（按钮、开关等），与 badge 共存时 badge 排在最右。 -->
<script setup>
defineProps({
  index: { type: [Number, String], default: '' },
  title: { type: String, required: true },
  badge: { type: String, default: '' },
});
</script>

<template>
  <el-card shadow="never" class="card">
    <template #header>
      <div class="step-head">
        <span v-if="index !== ''" class="step-no">{{ index }}</span>
        <span class="step-title">{{ title }}</span>
        <span v-if="$slots.extra" class="step-extra"><slot name="extra" /></span>
        <span v-if="badge" class="step-badge">{{ badge }}</span>
      </div>
    </template>
    <slot />
  </el-card>
</template>

<style scoped>
.step-head {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}
.step-no {
  flex: none;
  width: 22px;
  height: 22px;
  border-radius: 999px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: var(--brand-soft);
  color: var(--brand-dark);
  font-size: 12px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}
.step-title {
  font-size: var(--fs-title);
  font-weight: 600;
  color: var(--text-1);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.step-extra {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 10px;
  flex: none;
}
.step-badge {
  flex: none;
  margin-left: auto;
  font-size: var(--fs-xs);
  font-weight: 600;
  color: var(--warning-strong);
  background: var(--warning-soft);
  padding: 2px 10px;
  border-radius: 999px;
  white-space: nowrap;
}
/* extra 与 badge 共存时：extra 已负责右推，badge 紧随其后不留缝 */
.step-extra + .step-badge { margin-left: 0; }
</style>
