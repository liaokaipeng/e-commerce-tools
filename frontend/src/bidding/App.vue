<script setup>
import { ref, onMounted } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import LoginCard from '../components/LoginCard.vue';
import StorePicker from '../components/StorePicker.vue';
import DirRow from '../components/DirRow.vue';
import LogPanel from '../components/LogPanel.vue';
import { useShopeeSession } from '../composables/useShopeeSession.js';
import { useDirSettings, readSSE } from '../composables/useToolPage.js';

// ---------- 登录状态 + 店铺列表（与取消竞价共用） ----------
const {
  status, refreshing, flash, refreshStatus,
  stores, selected, selCount, clearAll,
} = useShopeeSession('Cookie 已就绪，可直接选择店铺导出。');

// ---------- 保存位置 ----------
const { dir, hasDefault, loadSettings: loadDirSettings, setDefaultDir, openDir } = useDirSettings('bidding', log);

// ---------- 日志 ----------
const logLines = ref([]);

function log(msg, cls) {
  const time = new Date().toLocaleTimeString();
  logLines.value.push({ time, msg, cls });
}

// ---------- 导出 ----------
const exporting = ref(false);

async function doExport() {
  const d = dir.value.trim();
  if (!d) {
    log('请先设置保存目录', 'err');
    ElMessage.warning('请先设置保存目录');
    return;
  }
  if (!hasDefault.value) {
    try {
      await ElMessageBox.confirm(
        `是否将「${d}」设为默认目录？下次打开会自动使用该目录。`,
        '默认目录',
        { confirmButtonText: '设为默认', cancelButtonText: '暂不', type: 'info' }
      );
      await setDefaultDir(d);
    } catch {
      /* 用户取消，继续导出 */
    }
  }
  exporting.value = true;
  logLines.value = [];
  log('开始导出，共 ' + selected.size + ' 个店铺…', 'info');
  try {
    const resp = await fetch('/api/export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ shopIds: [...selected], dir: d }),
    });
    if (!resp.ok || !resp.body) {
      const err = await resp.json().catch(() => ({}));
      log(err.msg || err.message || '请求失败', 'err');
      return;
    }
    await readSSE(resp, (ev) => {
      if (ev.type === 'start') {
        log(`▶ ${ev.name}（${ev.shopId}）导出中…`, 'info');
      } else if (ev.type === 'done') {
        if (ev.ok) {
          log(`✓ ${ev.name}（${ev.shopId}）导出成功：${ev.rows} 条 → ${ev.file}`, 'ok');
        } else {
          log(`✕ ${ev.name}（${ev.shopId}）失败：${ev.msg}`, 'err');
        }
      } else if (ev.type === 'summary') {
        log(`完成：成功 ${ev.success} / 失败 ${ev.failed} / 共 ${ev.total} 个店铺。`, 'info');
      } else if (ev.type === 'fatal') {
        log(ev.msg, 'err');
      }
    });
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

      <LoginCard :status="status" :refreshing="refreshing" :flash="flash" @refresh="refreshStatus(true)" />

      <StorePicker :stores="stores" :selected="selected" />

      <el-card shadow="never" class="card">
        <template #header>③ 保存位置</template>
        <DirRow
          v-model:dir="dir"
          :has-default="hasDefault"
          placeholder="例如 D:\data\竞价导出"
          @set-default="setDefaultDir"
          @open="openDir"
        />
      </el-card>

      <el-card shadow="never" class="card">
        <template #header>④ 导出</template>
        <div class="actions">
          <el-button type="primary" size="large" :disabled="selCount === 0" :loading="exporting" @click="doExport">
            {{ exporting ? '导出中…' : '开始导出' }}
          </el-button>
          <el-button @click="clearAll">清空选择</el-button>
          <span class="sel-count">已选 {{ selCount }} 个店铺</span>
        </div>
        <div class="log-box">
          <LogPanel :lines="logLines" height="260px" />
        </div>
      </el-card>
    </div>
  </div>
</template>

<style scoped>
.sel-count { font-size: 13px; color: #666; }
.log-box { margin-top: 14px; }
</style>
