// 开放平台页 · 授权：授权链接生成、转发页代码片段、剪贴板复制、手动粘贴回调完成授权。
// 从 openapi/App.vue 抽出；复制统一走共享 utils/clipboard.js 的 copyText。
import { ref } from 'vue';
import { ElMessage } from 'element-plus';
import { copyText } from '../utils/clipboard.js';

export function useOpenapiAuth({ form, refreshStatus }) {
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
    if (await copyText(authUrl.value)) ElMessage.success('授权链接已复制到剪贴板');
    else ElMessage.warning('复制失败，请手动选中复制');
  }

  async function copySnippet() {
    if (await copyText(forwardSnippet)) ElMessage.success('转发页代码已复制');
    else ElMessage.warning('复制失败，请手动选中复制');
  }

  return {
    generating, authUrl, manualUrl, manualing, forwardSnippet,
    generateAuthUrl, manualComplete, openAuthPage, copyAuthUrl, copySnippet,
  };
}
