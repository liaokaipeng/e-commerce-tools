<!-- 开放平台 · ① App 配置卡片（展示层）。
     状态与读写逻辑在 openapi/useOpenapiStatus.js，本组件只负责渲染并上抛保存事件。 -->
<script setup>
import StepCard from '../components/StepCard.vue';

defineProps({
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
  <StepCard :index="1" title="App 配置（开放平台开发者账号）">
    <el-form label-width="130px" @submit.prevent>
      <el-form-item label="partner_id">
        <el-input v-model="form.partnerId" placeholder="开放平台 App 的 partner_id" />
      </el-form-item>
      <el-form-item label="partner_key">
        <div class="key-block">
          <el-input
            v-model="form.partnerKey"
            type="password"
            show-password
            :placeholder="status.configured ? '已保存，如需更换请重新输入（留空则保持不变）' : '开放平台 App 的 partner_key'"
          />
          <!-- 完整 key 不回显（安全约束），输入框为空不代表未配置：这里明确给出已保存的打码值 -->
          <div v-if="status.configured" class="hint key-saved">
            已保存：{{ status.partnerKeyMasked }}（留空保存则保持不变）
          </div>
        </div>
      </el-form-item>
      <el-form-item label="环境">
        <el-select v-model="form.env" class="env-select">
          <el-option label="生产环境（正式接口）" value="prod" />
          <el-option label="沙箱环境（测试接口）" value="sandbox" />
        </el-select>
      </el-form-item>
      <el-form-item>
        <el-button
          type="primary"
          :loading="saving"
          :disabled="!form.partnerId || (!form.partnerKey && !status.configured)"
          @click="emit('save')"
        >
          保存配置
        </el-button>
        <el-tag v-if="status.configured" type="success" effect="light" class="configured-tag">
          已配置：{{ status.partnerId }}（key {{ status.partnerKeyMasked }}，{{ envLabel(status.env) }}）
        </el-tag>
      </el-form-item>
    </el-form>
    <el-alert type="info" :closable="false" show-icon
      title="凭证只保存在本机，不上传；key 保存后不再完整显示。" />
  </StepCard>
</template>

<style scoped>
.key-block { width: 100%; }
.key-saved { margin-top: var(--sp-1); }
.env-select { width: 220px; }
.configured-tag { margin-left: var(--sp-3); }
</style>
