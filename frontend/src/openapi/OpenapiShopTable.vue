<!-- 开放平台 · ③ 已授权店铺卡片（展示层）。
     逐店操作与批量刷新逻辑在 openapi/useOpenapiShops.js / useOpenapiBatchRefresh.js，
     本组件只负责渲染并上抛事件。 -->
<script setup>
const props = defineProps({
  /** 登录状态（shops / loading） */
  status: { type: Object, required: true },
  /** 批量刷新 SSE 状态机 */
  batch: { type: Object, required: true },
  /** 批量刷新进度文案 */
  batchProgress: { type: String, default: '' },
  /** 正在操作中的店铺集合（Set） */
  busyShop: { type: Object, required: true },
  /** 环境展示文案格式化函数 */
  envLabel: { type: Function, required: true },
  /** 店铺状态标签格式化函数 */
  stateMeta: { type: Function, required: true },
  /** 时间戳格式化函数 */
  fmtTime: { type: Function, required: true },
});

const emit = defineEmits(['refresh-status', 'refresh-all', 'cancel-refresh-all', 'test-shop', 'refresh-shop', 'remove-shop']);
</script>

<template>
  <el-card shadow="never" class="card">
    <template #header>
      <div class="card-header-row">
        <span>③ 已授权店铺</span>
        <div class="row">
          <span v-if="batch.running" class="hint">{{ batchProgress }}</span>
          <el-button size="small" :disabled="batch.running" :loading="status.loading" @click="emit('refresh-status')">刷新状态</el-button>
          <el-button size="small" type="warning" :loading="batch.running" :disabled="!status.shops.length" @click="emit('refresh-all')">
            批量刷新 token
          </el-button>
          <el-button v-if="batch.running" size="small" type="danger" plain @click="emit('cancel-refresh-all')">取消</el-button>
        </div>
      </div>
    </template>
    <el-table v-loading="status.loading" :data="status.shops" empty-text="暂无已授权店铺，请先完成 ② 店铺授权">
      <el-table-column prop="shopId" label="店铺 ID" min-width="140" />
      <el-table-column label="环境" width="80">
        <template #default="{ row }">{{ envLabel(row.env) }}</template>
      </el-table-column>
      <el-table-column label="access_token 到期" min-width="170">
        <template #default="{ row }">{{ fmtTime(row.accessExpireAt) }}</template>
      </el-table-column>
      <el-table-column label="状态" width="110">
        <template #default="{ row }">
          <el-tag :type="stateMeta(row).type" effect="light">{{ stateMeta(row).label }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="最近更新" min-width="170">
        <template #default="{ row }">{{ fmtTime(row.updatedAt / 1000) }}</template>
      </el-table-column>
      <el-table-column label="操作" width="230">
        <template #default="{ row }">
          <el-button size="small" :disabled="batch.running" :loading="busyShop.has(row.shopId)" @click="emit('test-shop', row.shopId)">测试</el-button>
          <el-button size="small" type="warning" :disabled="busyShop.has(row.shopId) || batch.running" @click="emit('refresh-shop', row.shopId)">
            刷新 token
          </el-button>
          <el-button size="small" type="danger" plain :disabled="busyShop.has(row.shopId) || batch.running" @click="emit('remove-shop', row.shopId)">
            删除
          </el-button>
        </template>
      </el-table-column>
    </el-table>
    <div class="hint" style="margin-top: 8px">
      access_token 约 4 小时有效（过期自动刷新）；refresh_token 约 30 天有效，长期不用需重新授权。<br />
      批量刷新按共享 token 分组整组续期（每组只刷一次）；短时间内刚刷新过会跳过重复刷新（防连点把刚轮换的凭证刷死），同一时刻只允许一个批量任务在跑；标「需重新授权」的店铺会被跳过，重新授权后自动恢复。
    </div>
  </el-card>
</template>
