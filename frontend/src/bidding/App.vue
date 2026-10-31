<script setup>
// Shopee 竞价导出页（编排层）：登录/店铺（useShopeeSession）、目录（useDirSettings）、
// 日志（useLog）、SSE 导出。展示统一走 PageHeader + StepCard + RunControl 骨架。
import { ref, onMounted } from 'vue';
import { ElMessage } from 'element-plus';
import PageHeader from '../components/PageHeader.vue';
import LoginCard from '../components/LoginCard.vue';
import StorePicker from '../components/StorePicker.vue';
import StepCard from '../components/StepCard.vue';
import RunControl from '../components/RunControl.vue';
import DirRow from '../components/DirRow.vue';
import LogPanel from '../components/LogPanel.vue';
import { useShopeeSession } from '../composables/useShopeeSession.js';
import { useDirSettings } from '../composables/useDirSettings.js';
import { useLog } from '../composables/useLog.js';
import { runSSE } from '../composables/useSSE.js';

// ---------- 登录状态 + 店铺列表（与取消竞价共用） ----------
const {
  status, refreshing, flash, refreshStatus,
  stores, storesLoading, storesEmptyTip, selected, selCount, clearAll, loadStores,
} = useShopeeSession('Cookie 已就绪，可直接选择店铺导出。');

// ---------- 日志 ----------
const { logLines, log, clear: clearLog } = useLog();

// ---------- 保存位置 ----------
const { dir, loadSettings: loadDirSettings, setDefaultDir, ensureDefaultDir, openDir } = useDirSettings('bidding', log);

// ---------- 导出 ----------
const exporting = ref(false);
// 可视化进度：逐店 done 事件计数（total = 本次已选店铺数）
const progress = ref({ done: 0, total: 0, fail: 0 });

async function doExport() {
  const d = dir.value.trim();
  if (!d) {
    log('请先设置保存目录', 'err');
    ElMessage.warning('请先设置保存目录');
    return;
  }
  await ensureDefaultDir(d);
  /* 用户取消则继续导出 */
  exporting.value = true;
  clearLog();
  progress.value = { done: 0, total: selected.size, fail: 0 };
  log('开始导出，共 ' + selected.size + ' 个店铺…', 'info');
  try {
    await runSSE('/api/export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ shopIds: [...selected], dir: d }),
    }, (ev) => {
      if (ev.type === 'start') {
        log(`▶ ${ev.name}（${ev.shopId}）导出中…`, 'info');
      } else if (ev.type === 'done') {
        if (ev.ok) {
          log(`✓ ${ev.name}（${ev.shopId}）导出成功：${ev.rows} 条 → ${ev.file}`, 'ok');
        } else {
          log(`✕ ${ev.name}（${ev.shopId}）失败：${ev.msg}`, 'err');
          progress.value.fail += 1;
        }
        progress.value.done += 1;
      } else if (ev.type === 'summary') {
        log(`完成：成功 ${ev.success} / 失败 ${ev.failed} / 共 ${ev.total} 个店铺。`, 'info');
        if (ev.failed) ElMessage.warning(`导出完成，${ev.failed} 个店铺失败，详见日志`);
        else ElMessage.success('导出完成');
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

onMounted(() => {
  loadDirSettings();
});
</script>

<template>
  <div class="page">
    <div class="container">
      <PageHeader title="竞价导出" desc="拉取选中店铺的获胜竞价数据，导出 Excel 到本机目录" />

      <LoginCard :status="status" :refreshing="refreshing" :flash="flash" @refresh="refreshStatus(true)" />

      <StorePicker :stores="stores" :selected="selected" :loading="storesLoading" :empty-tip="storesEmptyTip" :reload="loadStores" />

      <StepCard :index="3" title="保存位置">
        <DirRow
          v-model:dir="dir"
          placeholder="例如 D:\data\竞价导出"
          @set-default="setDefaultDir"
          @open="openDir"
        />
      </StepCard>

      <StepCard :index="4" title="导出">
        <RunControl
          action-text="开始导出"
          running-text="导出中…"
          :running="exporting"
          :can-run="selCount > 0"
          :pausable="false"
          :cancellable="false"
          :progress="exporting ? progress : null"
          tip="导出按店铺逐个进行，文件保存到上方设置的目录。"
        >
          <template #extra-actions>
            <el-button size="large" @click="clearAll">清空选择</el-button>
          </template>
        </RunControl>
        <div class="log-box">
          <LogPanel :lines="logLines" />
        </div>
      </StepCard>
    </div>
  </div>
</template>
