<script setup>
import { ref, watch, onMounted } from 'vue';
import LoginCard from '../components/LoginCard.vue';
import StorePicker from '../components/StorePicker.vue';
import DirRow from '../components/DirRow.vue';
import LogPanel from '../components/LogPanel.vue';
import { useShopeeSession } from '../composables/useShopeeSession.js';
import { useDirSettings, useLog, runSSE } from '../composables/useToolPage.js';

// ---------- 登录状态 + 店铺列表（与竞价导出共用 Cookie/店铺） ----------
const {
  status, refreshing, flash, refreshStatus,
  stores, selected, selCount, clearAll,
} = useShopeeSession('Cookie 已就绪，进入本页将自动开始导出商品数据。');

// 默认勾选跨境店铺 557630453（商品数据导出目标店铺）
const DEFAULT_SHOP_ID = '557630453';
let autoSelected = false;
watch(stores, (list) => {
  if (autoSelected) return;
  if (list.some((s) => s.id === DEFAULT_SHOP_ID)) {
    selected.add(DEFAULT_SHOP_ID);
    autoSelected = true;
  }
}, { immediate: true });

// ---------- 日志 ----------
const { logLines, log, clear: clearLog } = useLog();

// ---------- 保存位置（未设置时后端默认保存到系统「下载」文件夹） ----------
const { dir, hasDefault, loadSettings: loadDirSettings, setDefaultDir, openDir } = useDirSettings('product-export', log);

// ---------- 导出 ----------
const exporting = ref(false);
let autoStarted = false;

async function doExport(silent = false) {
  if (exporting.value) return;
  if (selCount.value === 0) {
    if (!silent) log('请先勾选要导出的店铺', 'err');
    return;
  }
  exporting.value = true;
  clearLog();
  if (!dir.value.trim()) {
    log('未设置保存目录，将默认保存到系统「下载」文件夹。', 'info');
  }
  log(`开始导出，共 ${selCount.value} 个店铺…`, 'info');
  try {
    await runSSE('/api/product-export/export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ shopIds: [...selected], dir: dir.value.trim() }),
    }, (ev) => {
      if (ev.type === 'start') {
        log(`▶ 店铺 ${ev.shopId} 导出中…`, 'info');
      } else if (ev.type === 'list') {
        if (ev.total) {
          log(`已拉取商品列表：${ev.got} / ${ev.total}`, 'info');
        } else {
          log(`已拉取商品列表：${ev.got} 个`, 'info');
        }
      } else if (ev.type === 'progress') {
        log(`拉取规格详情进度：${ev.done} / ${ev.total}`, 'info');
      } else if (ev.type === 'done') {
        if (ev.ok) {
          log(`✓ 店铺 ${ev.shopId} 导出成功：${ev.rows} 个规格（${ev.total} 个商品）→ ${ev.file}`, 'ok');
        } else {
          log(`✕ 店铺 ${ev.shopId} 失败：${ev.msg}`, 'err');
        }
      } else if (ev.type === 'summary') {
        log(`完成：成功 ${ev.success} / 失败 ${ev.failed} / 共 ${ev.total} 个店铺。`, 'info');
      } else if (ev.type === 'fatal') {
        log(ev.msg, 'err');
      }
    }, log);
  } catch (e) {
    log('导出请求失败：' + e.message, 'err');
  } finally {
    exporting.value = false;
  }
}

// 进入本页且登录就绪后自动导出一次（「点击功能卡片即直接导出」）：
// 首次状态检查完成、已登录、且未自动导出过 → 触发
watch(() => [status.checking, status.loggedIn], ([checking, loggedIn]) => {
  if (autoStarted || checking || !loggedIn) return;
  autoStarted = true;
  log('检测到登录就绪，自动开始导出商品数据…', 'info');
  doExport(true);
});

onMounted(() => {
  loadDirSettings();
});
</script>

<template>
  <div class="page">
    <div class="container">

      <LoginCard :status="status" :refreshing="refreshing" :flash="flash" @refresh="refreshStatus(true)" />

      <StorePicker :stores="stores" :selected="selected" />

      <el-card shadow="never" class="card">
        <template #header>③ 保存位置</template>
        <DirRow
          v-model:dir="dir"
          :has-default="hasDefault"
          placeholder="留空则默认保存到系统「下载」文件夹"
          @set-default="setDefaultDir"
          @open="openDir"
        />
      </el-card>

      <el-card shadow="never" class="card">
        <template #header>④ 导出商品数据（每个规格一行，含 SKU 图片链接）</template>
        <div class="actions">
          <el-button type="primary" size="large" :disabled="selCount === 0" :loading="exporting" @click="doExport(false)">
            {{ exporting ? '导出中…' : '一键导出商品数据 → Excel' }}
          </el-button>
          <el-button @click="clearAll">清空选择</el-button>
          <span class="sel-count">已选 {{ selCount }} 个店铺</span>
        </div>
        <div class="tips">
          导出字段：商品ID / 商品名称 / 规格ID / 卖家SKU / 规格信息（规格名、规格值及图片链接）/ SKU图片链接 / 价格 / 库存 / 销量等；
          登录就绪后进入本页会自动导出一次，可随时再次点击导出。
        </div>
        <div class="log-box">
          <LogPanel :lines="logLines" height="260px" />
        </div>
      </el-card>
    </div>
  </div>
</template>

<style scoped>
/* 页面级样式已统一收敛到 styles/base.css（.sel-count / .log-box 为全局类） */
.tips {
  font-size: 12px;
  color: var(--text-3, #999);
  line-height: 1.6;
  margin: 10px 0;
}
</style>
