// 开放平台页 · 登录状态：status 状态、App 配置表单与读写、30s 轮询及生命周期。
// 从 openapi/App.vue 抽出（原单文件混了状态 / 授权 / 逐店操作 / 批量刷新四块职责）。
import { ref, reactive, onMounted, onUnmounted } from 'vue';
import { ElMessage } from 'element-plus';

export function useOpenapiStatus() {
  const status = reactive({ configured: false, env: '', partnerId: '', partnerKeyMasked: '', shops: [], loading: true });
  const form = reactive({
    partnerId: '',
    partnerKey: '',
    env: 'prod',
    redirect: 'https://example.com/',
  });
  const saving = ref(false);

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

  let timer = null;
  onMounted(() => {
    refreshStatus();
    timer = setInterval(() => refreshStatus(), 30000); // 每 30s 刷新到期状态
  });
  onUnmounted(() => {
    if (timer) clearInterval(timer);
  });

  return { status, form, saving, refreshStatus, saveApp };
}
