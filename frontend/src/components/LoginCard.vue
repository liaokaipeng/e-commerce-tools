<!-- ① 登录（Cookie）状态卡：bidding / bidding-cancel 共用 -->
<script setup>
defineProps({
  status: { type: Object, required: true },
  refreshing: { type: Boolean, default: false },
  flash: { type: Boolean, default: false },
});
const emit = defineEmits(['refresh']);
</script>

<template>
  <el-card shadow="never" class="card">
    <template #header>① 登录（Cookie）</template>
    <div class="status-bar" :class="{ flash }">
      <el-tag :type="status.checking ? 'info' : status.loggedIn ? 'success' : 'danger'" effect="light">
        <span class="dot" :class="status.loggedIn ? 'ok' : 'err'"></span>
        {{ status.checking ? '检查中…' : status.loggedIn ? '已登录' : '未登录' }}
      </el-tag>
      <span class="status-tip">{{ status.tip }}</span>
      <el-button size="small" :loading="refreshing" @click="emit('refresh')">刷新状态</el-button>
    </div>
  </el-card>
</template>

<style scoped>
.status-bar {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
  flex-wrap: wrap;
  padding: var(--sp-1);
}
.status-bar.flash { animation: flashBg 0.6s ease; }
@keyframes flashBg {
  0% { background: #fff8e1; }
  100% { background: transparent; }
}
.dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  margin-right: 6px;
}
.dot.ok { background: var(--success); }
.dot.err { background: var(--danger); }
.status-tip { font-size: var(--fs-sm); color: var(--text-2); flex: 1; min-width: 200px; }
</style>
