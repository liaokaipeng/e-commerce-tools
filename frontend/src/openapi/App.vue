<script setup>
// 开放平台 API 登录：App 配置 → 生成授权链接 → 店铺授权回调换 token → 店铺管理。
// 后端：/api/openapi/*（server/openapi.js），token 存本机 server/data/openapi-session.json（不入库）。
// 本文件只做编排：状态 / 授权 / 逐店管理 / 批量刷新分别下沉到 useOpenapi*.js，模板片段下沉到子卡片组件。
import { useOpenapiStatus } from './useOpenapiStatus.js';
import { useOpenapiAuth } from './useOpenapiAuth.js';
import { useOpenapiShops } from './useOpenapiShops.js';
import { useOpenapiBatchRefresh } from './useOpenapiBatchRefresh.js';
import OpenapiAppCard from './OpenapiAppCard.vue';
import OpenapiAuthCard from './OpenapiAuthCard.vue';
import OpenapiShopTable from './OpenapiShopTable.vue';

const { status, form, saving, refreshStatus, saveApp } = useOpenapiStatus();
const { authUrl, manualUrl, generating, manualing, forwardSnippet, generateAuthUrl, manualComplete, openAuthPage, copyAuthUrl, copySnippet } = useOpenapiAuth({ form, refreshStatus });
const { busyShop, testShop, refreshShop, removeShop, toggleImportant, stateMeta, fmtTime, envLabel } = useOpenapiShops({ refreshStatus });
const { batch, batchProgress, refreshAll, cancelRefreshAll } = useOpenapiBatchRefresh({ refreshStatus });
</script>

<template>
  <div class="page">
    <div class="container">

      <OpenapiAppCard
        :form="form"
        :status="status"
        :saving="saving"
        :env-label="envLabel"
        @save="saveApp"
      />

      <OpenapiAuthCard
        :form="form"
        :status="status"
        v-model:auth-url="authUrl"
        v-model:manual-url="manualUrl"
        :generating="generating"
        :manualing="manualing"
        :forward-snippet="forwardSnippet"
        @generate="generateAuthUrl"
        @copy-auth-url="copyAuthUrl"
        @open-auth-page="openAuthPage"
        @manual-complete="manualComplete"
        @copy-snippet="copySnippet"
      />

      <OpenapiShopTable
        :status="status"
        :batch="batch"
        :batch-progress="batchProgress"
        :busy-shop="busyShop"
        :env-label="envLabel"
        :state-meta="stateMeta"
        :fmt-time="fmtTime"
        @refresh-status="refreshStatus(true)"
        @refresh-all="refreshAll"
        @cancel-refresh-all="cancelRefreshAll"
        @test-shop="testShop"
        @refresh-shop="refreshShop"
        @remove-shop="removeShop"
        @toggle-important="toggleImportant"
      />

    </div>
  </div>
</template>

<style scoped>
/* 本页有 7 列的店铺表格（含「重点」「操作」列），900/960 宽会把最右「操作」列挤出可视区，故单独放宽 */
.container { max-width: 1200px; }
</style>
