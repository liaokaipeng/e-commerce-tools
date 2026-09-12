<script setup>
import { ref, reactive, onMounted, onUnmounted } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';

// 开放平台 API 登录：App 配置 → 生成授权链接 → 店铺授权回调换 token → 店铺管理。
// 后端：/api/openapi/*（server/openapi.js），token 存本机 server/data/openapi-session.json（不入库）。

// ---------- 登录状态 ----------
const status = reactive({ configured: false, env: '', partnerId: '', partnerKeyMasked: '', shops: [], loading: true });
const form = reactive({
  partnerId: '',
  partnerKey: '',
  env: 'prod',
  redirect: 'https://example.com/',
});
const saving = ref(false);
const generating = ref(false);
const authUrl = ref('');
const authMode = ref('auto'); // auto=自动跳回本工具；manual=授权后需手动粘贴回调链接
const manualUrl = ref('');
const manualing = ref(false);
// 有域名时的转发页代码：官方授权后跳到你的域名 → 原样转回本机工具，实现全自动
// 注意：代码里不能出现字面的 script 闭合标签（会提前终止本组件的 script 块），故拆开拼接
const forwardSnippet = [
  '<!DOCTYPE html>',
  '<html lang="zh-CN"><body><scr' + 'ipt>',
  '// Shopee 授权回调转发页：把官方跳转（含 code/shop_id）原样转回本机工具',
  "location.replace('http://127.0.0.1:8765/openapi/callback' + location.search);",
  '</scr' + 'ipt></body></html>',
].join('\n');
const busyShop = reactive(new Set()); // 正在操作中的店铺

async function refreshStatus(manual = false) {
  status.loading = true;
  try {
    const r = await fetch('/api/openapi/status');
    const s = await r.json();
    if (s && s.ok) {
      Object.assign(status, s);
      if (s.configured && !form.partnerId) {
        form.partnerId = s.partnerId;
        form.env = s.env;
      }
      if (manual) ElMessage.success('状态已刷新');
    } else if (manual) {
      ElMessage.error((s && s.message) || '状态读取失败');
    }
  } catch {
    if (manual) ElMessage.error('读取失败：本地服务未启动或连接异常，请确认 启动.bat 正在运行');
  } finally {
    status.loading = false;
  }
}

// ---------- ① 保存 App 配置 ----------
async function saveApp() {
  saving.value = true;
  try {
    const r = await fetch('/api/openapi/app', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ partnerId: form.partnerId, partnerKey: form.partnerKey, env: form.env }),
    });
    const j = await r.json();
    if (r.ok && j.ok) {
      ElMessage.success(j.message || '已保存');
      form.partnerKey = '';
      await refreshStatus();
    } else {
      ElMessage.error(j.message || '保存失败');
    }
  } catch (e) {
    ElMessage.error('本地服务异常：' + e.message);
  } finally {
    saving.value = false;
  }
}

// ---------- ② 生成授权链接 ----------
async function generateAuthUrl() {
  generating.value = true;
  try {
    const r = await fetch('/api/openapi/auth-url', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ redirect: form.redirect }),
    });
    const j = await r.json();
    if (r.ok && j.ok) {
      authUrl.value = j.authUrl;
      authMode.value = j.mode || 'auto';
      if (authMode.value === 'auto') ElMessage.success('授权链接已生成，授权后将自动跳回本工具');
      else ElMessage.warning('授权后浏览器会跳到上面的回调地址，请把地址栏完整链接复制到下方「手动完成授权」');
    } else {
      ElMessage.error(j.message || '生成失败');
    }
  } catch (e) {
    ElMessage.error('本地服务异常：' + e.message);
  } finally {
    generating.value = false;
  }
}

// 手动完成授权：粘贴授权跳转后的完整回调链接换取 token。
// 主账号授权时链接只有 ?code=…&main_account_id=…（无 shop_id），属正常情况。
async function manualComplete() {
  let u;
  try {
    u = new URL(manualUrl.value.trim());
  } catch {
    ElMessage.error('粘贴的地址不完整：需包含 http(s):// 前缀');
    return;
  }
  const code = u.searchParams.get('code');
  const shopId = u.searchParams.get('shop_id') || '';
  const mainAccountId = u.searchParams.get('main_account_id') || '';
  if (!code) {
    ElMessage.error('链接里没有 code，请复制授权跳转后的完整地址栏内容');
    return;
  }
  if (!shopId && !mainAccountId) {
    ElMessage.error('链接里没有 shop_id 也没有 main_account_id，请复制授权跳转后的完整地址栏内容');
    return;
  }
  manualing.value = true;
  try {
    const r = await fetch('/api/openapi/auth-callback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, shopId, mainAccountId }),
    });
    const j = await r.json();
    if (r.ok && j.ok) {
      ElMessage.success(j.message || '授权成功');
      manualUrl.value = '';
      authUrl.value = '';
      await refreshStatus();
    } else {
      ElMessage.error(j.message || '授权失败');
    }
  } catch (e) {
    ElMessage.error('本地服务异常：' + e.message);
  } finally {
    manualing.value = false;
  }
}

function openAuthPage() {
  if (!authUrl.value) return;
  window.open(authUrl.value, '_blank');
}

async function copyAuthUrl() {
  if (!authUrl.value) return;
  try {
    await navigator.clipboard.writeText(authUrl.value);
    ElMessage.success('授权链接已复制到剪贴板');
  } catch (e) {
    ElMessage.warning('复制失败，请手动选中复制');
  }
}

async function copySnippet() {
  try {
    await navigator.clipboard.writeText(forwardSnippet);
    ElMessage.success('转发页代码已复制');
  } catch (e) {
    ElMessage.warning('复制失败，请手动选中复制');
  }
}

// ---------- ③ 店铺管理 ----------
async function withShop(shopId, fn) {
  if (busyShop.has(shopId)) return;
  busyShop.add(shopId);
  try {
    await fn();
  } finally {
    busyShop.delete(shopId);
    await refreshStatus();
  }
}

async function testShop(shopId) {
  await withShop(shopId, async () => {
    const r = await fetch('/api/openapi/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ shopId }),
    });
    const j = await r.json();
    if (r.ok && j.ok) ElMessage.success(j.message || '登录有效');
    else ElMessage.error(j.message || '测试失败');
  });
}

async function refreshShop(shopId) {
  await withShop(shopId, async () => {
    const r = await fetch('/api/openapi/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ shopId }),
    });
    const j = await r.json();
    if (r.ok && j.ok) ElMessage.success(j.message || '刷新成功');
    else ElMessage.error(j.message || '刷新失败');
  });
}

async function removeShop(shopId) {
  try {
    await ElMessageBox.confirm(`确定删除店铺 ${shopId} 的授权吗？删除后相关功能将无法调用官方接口。`, '删除授权', {
      confirmButtonText: '删除',
      cancelButtonText: '取消',
      type: 'warning',
    });
  } catch {
    return; // 用户取消
  }
  await withShop(shopId, async () => {
    const r = await fetch('/api/openapi/remove-shop', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ shopId }),
    });
    const j = await r.json();
    if (r.ok && j.ok) ElMessage.success(j.message || '已删除');
    else ElMessage.error(j.message || '删除失败');
  });
}

function stateMeta(s) {
  if (s.state === 'valid') return { type: 'success', label: '有效' };
  if (s.state === 'expiring') return { type: 'warning', label: '即将过期' };
  if (s.state === 're_auth') return { type: 'danger', label: '需重新授权' };
  return { type: 'danger', label: '已过期' };
}

function fmtTime(t) {
  return t ? new Date(t * 1000).toLocaleString('zh-CN', { hour12: false }) : '—';
}

const envLabel = (e) => (e === 'sandbox' ? '沙箱' : '生产');

let timer = null;
onMounted(() => {
  refreshStatus();
  timer = setInterval(() => refreshStatus(), 30000); // 每 30s 刷新到期状态
});
onUnmounted(() => {
  if (timer) clearInterval(timer);
});
</script>

<template>
  <div class="page">
    <div class="container">

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
            <el-button type="primary" :loading="saving" :disabled="!form.partnerId || !form.partnerKey" @click="saveApp">
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
          <el-button type="primary" :loading="generating" :disabled="!status.configured" @click="generateAuthUrl">
            生成授权链接
          </el-button>
          <span v-if="!status.configured" class="hint">请先完成 ① 保存 App 配置</span>
        </div>
        <div v-if="authUrl" class="row" style="margin-top: 12px">
          <el-input v-model="authUrl" readonly class="auth-url" />
          <el-button @click="copyAuthUrl">复制链接</el-button>
          <el-button type="success" @click="openAuthPage">打开授权页</el-button>
        </div>
        <div class="hint" style="margin-top: 8px">
          打开授权页，用<b>主账号</b>登录授权（一次授权名下全部店铺）。授权后把浏览器地址栏完整链接粘贴到下方「手动完成授权」；链接约 30 分钟过期、授权码一次性（只有 code 与 main_account_id 是正常的）。
        </div>
        <el-divider />
        <div class="row">
          <el-input v-model="manualUrl" placeholder="粘贴授权跳转后的完整链接，如 https://example.com/?code=…&main_account_id=…" class="auth-url" />
          <el-button type="warning" :loading="manualing" @click="manualComplete">手动完成授权</el-button>
        </div>
        <el-collapse class="domain-help">
          <el-collapse-item title="有域名？放转发页实现全自动（免粘贴）" name="forward">
            <div class="hint">
              把下面代码放到你域名的一个页面（如 <b>https://你的域名/openapi-callback/</b>），后台与本页回调地址都填该地址，授权后自动跳回本工具。<br />
              也可给域名加 A 记录 <b>local.你的域名 → 127.0.0.1</b>，回调地址填 <b>http://local.你的域名:8765/openapi/callback</b>。
            </div>
            <el-input :model-value="forwardSnippet" type="textarea" :rows="6" readonly class="snippet" />
            <el-button size="small" style="margin-top: 6px" @click="copySnippet">复制代码</el-button>
          </el-collapse-item>
        </el-collapse>
      </el-card>

      <el-card shadow="never" class="card">
        <template #header>
          ③ 已授权店铺
          <el-button size="small" style="float: right" :loading="status.loading" @click="refreshStatus(true)">刷新状态</el-button>
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
              <el-button size="small" :loading="busyShop.has(row.shopId)" @click="testShop(row.shopId)">测试</el-button>
              <el-button size="small" type="warning" :disabled="busyShop.has(row.shopId)" @click="refreshShop(row.shopId)">
                刷新 token
              </el-button>
              <el-button size="small" type="danger" plain :disabled="busyShop.has(row.shopId)" @click="removeShop(row.shopId)">
                删除
              </el-button>
            </template>
          </el-table-column>
        </el-table>
        <div class="hint" style="margin-top: 8px">
          access_token 约 4 小时有效（过期自动刷新）；refresh_token 约 30 天有效，长期不用需重新授权。
        </div>
      </el-card>

    </div>
  </div>
</template>

<style scoped>
.container { max-width: 960px; }
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
