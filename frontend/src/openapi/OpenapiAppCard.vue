<!-- 开放平台 · ① App 配置卡片（展示层）。
     状态与读写逻辑在 openapi/useOpenapiStatus.js，本组件只负责渲染并上抛保存事件。 -->
<script setup>
const props = defineProps({
  /** App 配置表单对象（partnerId / partnerKey / env / redirect），由父级共享 */
  form: { type: Object, required: true },
  /** 登录状态（configured / partnerId / partnerKeyMasked / env 等） */
  status: { type: Object, required: true },
  saving: { type: Boolean, default: false },
  /** 环境展示文案格式化函数 */
  envLabel: { type: Function, required: true },
});

const emit = defineEmits(['save']);
</script>

<template>
  <el-card shadow="never" class="card">
    <template #header>① App 配置（开放平台开发者账号）</template>
    <el-form label-width="130px" @submit.prevent>
      <el-form-item label="partner_id">
        <el-input v-model="form.partnerId" placeholder="开放平台 App 的 partner_id" />
      </el-form-item>
      <el-form-item label="partner_key">
        <el-input v-model="form.partnerKey" type="password" show-password placeholder="开放平台 App 的 partner_key" />
      </el-form-item>
      <el-form-item label="环境">
        <el-select v-model="form.env" style="width: 220px">
          <el-option label="生产环境（正式接口）" value="prod" />
          <el-option label="沙箱环境（测试接口）" value="sandbox" />
        </el-select>
      </el-form-item>
      <el-form-item>
        <el-button type="primary" :loading="saving" :disabled="!form.partnerId || !form.partnerKey" @click="emit('save')">
          保存配置
        </el-button>
        <el-tag v-if="status.configured" type="success" effect="light" style="margin-left: 12px">
          已配置：{{ status.partnerId }}（key {{ status.partnerKeyMasked }}，{{ envLabel(status.env) }}）
        </el-tag>
      </el-form-item>
    </el-form>
    <el-alert type="info" :closable="false" show-icon
      title="凭证只保存在本机，不上传；key 保存后不再完整显示。" />
  </el-card>
</template>
