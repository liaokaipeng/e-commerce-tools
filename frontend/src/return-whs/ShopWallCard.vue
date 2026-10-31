<!-- 获取退单仓库 · ① 授权店铺卡（只读校验用）：店铺由表格「店铺ID」列逐行决定，
     这里只展示已授权店铺与健康状态，不提供选择。 -->
<script setup>
import StepCard from '../components/StepCard.vue';
import OpenapiGuide from '../components/OpenapiGuide.vue';
import { shopStateMeta } from '../composables/shopState.js';

defineProps({
  shops: { type: Array, default: () => [] },
  shopsLoading: { type: Boolean, default: false },
  appConfigured: { type: Boolean, default: true },
  reload: { type: Function, default: null },
});

// 店铺展示名：店名优先（/api/openapi/status 回填的 shopName；失效店铺取不到名，回落「店铺 + ID」）
const shopLabel = (s) => (s.shopName ? `${s.shopName}（${s.shopId}）` : `店铺 ${s.shopId}`);
</script>

<template>
  <StepCard :index="1" title="授权店铺">
    <template #extra>
      <el-button size="small" :loading="shopsLoading" @click="reload()">刷新</el-button>
    </template>
    <div class="hint">店铺由表格「店铺ID」列逐行决定，这里只需确认这些店铺已授权（失效店铺需先去「开放平台」页重新授权）。</div>
    <div v-if="shops.length" class="shop-tags">
      <el-tag
        v-for="s in shops"
        :key="s.shopId"
        :type="shopStateMeta(s).type"
        size="small"
        effect="light"
      >{{ shopLabel(s) }} · {{ shopStateMeta(s).label }}</el-tag>
    </div>
    <OpenapiGuide v-if="!appConfigured" tip="尚未配置开放平台 App：请先到「开放平台」页录入 App 并完成店铺授权，再回来使用本工具。" />
    <OpenapiGuide v-else-if="!shops.length && !shopsLoading" tip="没有已授权店铺，请先到「开放平台」页授权。" />
  </StepCard>
</template>

<style scoped>
.shop-tags { display: flex; flex-wrap: wrap; gap: var(--sp-2); margin-top: var(--sp-3); }
</style>
