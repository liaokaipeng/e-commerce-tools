<!-- 开放平台 · ② 店铺授权卡片（展示层）。
     授权链接生成 / 复制 / 手动回调等逻辑在 openapi/useOpenapiAuth.js，本组件只负责渲染并上抛事件。 -->
<script setup>
const props = defineProps({
  /** App 配置表单对象（本卡片只读用其中的 redirect） */
  form: { type: Object, required: true },
  /** 登录状态（configured 等） */
  status: { type: Object, required: true },
  generating: { type: Boolean, default: false },
  manualing: { type: Boolean, default: false },
  /** 转发页 HTML 代码片段 */
  forwardSnippet: { type: String, default: '' },
});

const emit = defineEmits(['generate', 'copy-auth-url', 'open-auth-page', 'manual-complete', 'copy-snippet']);

// 生成好的授权链接（只读展示）与手动粘贴的回调链接（双向）
const authUrl = defineModel('authUrl', { type: String, default: '' });
const manualUrl = defineModel('manualUrl', { type: String, default: '' });
</script>

<template>
  <el-card shadow="never" class="card">
    <template #header>② 店铺授权</template>
    <el-form label-width="130px" @submit.prevent>
      <el-form-item label="回调地址 redirect">
        <el-input v-model="form.redirect" placeholder="https://example.com/" style="max-width: 480px" />
      </el-form-item>
    </el-form>
    <el-alert type="warning" :closable="false" show-icon style="margin-bottom: 12px"
      title="回调地址需为合法域名（不接受 127.0.0.1 / localhost 等本机地址，不能带 ?），后台与上面输入框填成一致；没有域名时两边都用 https://example.com/。" />
    <div class="row">
      <el-button type="primary" :loading="generating" :disabled="!status.configured" @click="emit('generate')">
        生成授权链接
      </el-button>
      <span v-if="!status.configured" class="hint">请先完成 ① 保存 App 配置</span>
    </div>
    <div v-if="authUrl" class="row" style="margin-top: 12px">
      <el-input v-model="authUrl" readonly class="auth-url" />
      <el-button @click="emit('copy-auth-url')">复制链接</el-button>
      <el-button type="success" @click="emit('open-auth-page')">打开授权页</el-button>
    </div>
    <div class="hint" style="margin-top: 8px">
      打开授权页，用<b>主账号</b>登录授权（一次授权名下全部店铺）。授权后把浏览器地址栏完整链接粘贴到下方「手动完成授权」；链接约 30 分钟过期、授权码一次性（只有 code 与 main_account_id 是正常的）。
    </div>
    <el-divider />
    <div class="row">
      <el-input v-model="manualUrl" placeholder="粘贴授权跳转后的完整链接，如 https://example.com/?code=…&main_account_id=…" class="auth-url" />
      <el-button type="warning" :loading="manualing" @click="emit('manual-complete')">手动完成授权</el-button>
    </div>
    <el-collapse class="domain-help">
      <el-collapse-item title="有域名？放转发页实现全自动（免粘贴）" name="forward">
        <div class="hint">
          把下面代码放到你域名的一个页面（如 <b>https://你的域名/openapi-callback/</b>），后台与本页回调地址都填该地址，授权后自动跳回本工具。<br />
          也可给域名加 A 记录 <b>local.你的域名 → 127.0.0.1</b>，回调地址填 <b>http://local.你的域名:8765/openapi/callback</b>。
        </div>
        <el-input :model-value="forwardSnippet" type="textarea" :rows="6" readonly class="snippet" />
        <el-button size="small" style="margin-top: 6px" @click="emit('copy-snippet')">复制代码</el-button>
      </el-collapse-item>
    </el-collapse>
  </el-card>
</template>

<style scoped>
.auth-url { flex: 1; min-width: 320px; }
.domain-help {
  margin-top: var(--sp-3);
  border: 1px dashed var(--border-strong);
  border-radius: var(--radius-md);
  background: var(--surface-2);
}
.domain-help .snippet { margin-top: var(--sp-2); }
.domain-help .snippet :deep(textarea) { font-family: var(--font-mono); font-size: var(--fs-xs); }
</style>
