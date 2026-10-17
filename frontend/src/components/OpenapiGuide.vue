<!-- 开放平台空态引导：未配置 App / 没有已授权店铺时给出去授权引导。
     StorePicker / return-whs / VideoSteps 三页原各持一份同构 markup + scoped 样式，现收敛于此；
     样式为全局类（定义在 styles/base.css），三页同为浅色主题。 -->
<script setup>
defineProps({
  /** 引导文案（由各页传入；原因区分的唯一权威仍是 composables/openapiEmptyTip.js） */
  tip: { type: String, default: '' },
  /** 「重新加载」按钮回调（不传则不渲染按钮） */
  reload: { type: Function, default: null },
});
</script>

<template>
  <div class="openapi-guide">
    <div class="openapi-guide-tip">{{ tip }}</div>
    <div class="openapi-guide-actions">
      <a href="/openapi/" target="_blank" rel="noopener">前往「开放平台」配置 / 授权 →</a>
      <el-button v-if="reload" size="small" @click="reload">重新加载</el-button>
    </div>
  </div>
</template>
