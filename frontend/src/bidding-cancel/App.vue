<script setup>
import { ref, computed } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import LoginCard from '../components/LoginCard.vue';
import StorePicker from '../components/StorePicker.vue';
import LogPanel from '../components/LogPanel.vue';
import { useShopeeSession } from '../composables/useShopeeSession.js';
import { useLog, readSSE } from '../composables/useToolPage.js';

// ---------- 登录状态 + 店铺列表（与竞价导出共用） ----------
const {
  status, refreshing, flash, refreshStatus,
  stores, selected, selCount, clearAll,
} = useShopeeSession('Cookie 已就绪，可直接选择店铺操作。');

// ---------- 日志 ----------
const { logLines, log, clear: clearLog } = useLog();

// ---------- 扫描（预览待改进竞价） ----------
const scanning = ref(false);
const previewShops = ref([]);
const totalBidCount = computed(() => previewShops.value.reduce((n, s) => n + (s.bidCount || 0), 0));
const previewDone = ref(false);

async function doScan() {
  if (selected.size === 0) {
    ElMessage.warning('请先选择至少一个店铺');
    return;
  }
  scanning.value = true;
  previewDone.value = false;
  previewShops.value = [];
  clearLog();
  log('开始扫描选中的 ' + selected.size + ' 个店铺的「待改进」竞价…', 'info');
  try {
    const resp = await fetch('/api/bidding-cancel/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ shopIds: [...selected] }),
    });
    const j = await resp.json();
    if (!j || !j.shops) {
      log(j && j.msg ? j.msg : '扫描请求失败', 'err');
      return;
    }
    previewShops.value = j.shops;
    for (const s of j.shops) {
      if (s.ok) {
        log(`✓ ${s.name}（${s.shopId}）：待改进竞价 ${s.bidCount} 条（${s.itemCount} 个商品）`, 'ok');
      } else {
        log(`✕ ${s.name}（${s.shopId}）扫描失败：${s.msg}`, 'err');
      }
    }
    const total = j.shops.reduce((n, s) => n + (s.bidCount || 0), 0);
    log(`扫描完成：共发现 ${total} 条待改进竞价。`, total > 0 ? 'info' : 'ok');
    if (total === 0) {
      ElMessage.info('没有发现待改进竞价，无需撤销。');
    }
    previewDone.value = true;
  } catch (e) {
    log('扫描请求失败：' + e.message, 'err');
  } finally {
    scanning.value = false;
  }
}

// ---------- 撤销竞价 ----------
const cancelling = ref(false);

async function doCancel() {
  if (selected.size === 0) {
    ElMessage.warning('请先选择至少一个店铺');
    return;
  }
  const hint = previewDone.value
    ? `上次扫描共发现 ${totalBidCount.value} 条待改进竞价。`
    : '尚未扫描，将实时拉取并撤销全部待改进竞价。';
  try {
    await ElMessageBox.confirm(
      `即将对选中的 ${selected.size} 个店铺撤销所有「待改进」竞价，撤销后不可恢复！\n${hint}\n\n确定要继续吗？`,
      '危险操作确认',
      { confirmButtonText: '继续撤销', cancelButtonText: '取消', type: 'warning', confirmButtonClass: 'el-button--danger' }
    );
  } catch {
    return; // 用户取消
  }
  cancelling.value = true;
  clearLog();
  log('开始撤销，共 ' + selected.size + ' 个店铺…', 'info');
  try {
    const resp = await fetch('/api/bidding-cancel/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ shopIds: [...selected] }),
    });
    if (!resp.ok || !resp.body) {
      const err = await resp.json().catch(() => ({}));
      log(err.msg || err.message || '请求失败', 'err');
      return;
    }
    await readSSE(resp, (ev) => {
      if (ev.type === 'shop-start') {
        log(`▶ ${ev.name}（${ev.shopId}）开始撤销…`, 'info');
      } else if (ev.type === 'bid-start') {
        log(`  · 撤销 ${ev.itemName}${ev.modelName ? '（' + ev.modelName + '）' : ''}…`, 'info');
      } else if (ev.type === 'bid-done') {
        if (ev.ok) {
          log(`    ✓ ${ev.itemName} 撤销成功`, 'ok');
        } else {
          log(`    ✕ ${ev.itemName} 撤销失败：${ev.msg}`, 'err');
        }
      } else if (ev.type === 'shop-done') {
        if (ev.ok) {
          log(`✓ ${ev.name}（${ev.shopId}）完成：撤销 ${ev.cancelled} 条，失败 ${ev.failed} 条。`, ev.failed ? 'err' : 'ok');
        } else {
          log(`✕ ${ev.name}（${ev.shopId}）失败：${ev.msg}`, 'err');
        }
      } else if (ev.type === 'summary') {
        log(`全部完成：共撤销 ${ev.cancelled} 条，失败 ${ev.failed} 条（${ev.success}/${ev.total} 个店铺成功）。`, ev.failed ? 'err' : 'ok');
        previewDone.value = false; // 状态已变化，提示重新扫描
      } else if (ev.type === 'fatal') {
        log(ev.msg, 'err');
      }
    });
  } catch (e) {
    log('撤销请求失败：' + e.message, 'err');
  } finally {
    cancelling.value = false;
  }
}
</script>

<template>
  <div class="page">
    <div class="container">

      <LoginCard :status="status" :refreshing="refreshing" :flash="flash" @refresh="refreshStatus(true)" />

      <StorePicker :stores="stores" :selected="selected" />

      <el-card shadow="never" class="card">
        <template #header>③ 扫描待改进竞价（预览）</template>
        <div class="actions">
          <el-button type="primary" :disabled="selCount === 0" :loading="scanning" @click="doScan">
            {{ scanning ? '扫描中…' : '扫描待改进竞价' }}
          </el-button>
          <el-button @click="clearAll">清空选择</el-button>
          <span class="sel-count">已选 {{ selCount }} 个店铺</span>
          <span v-if="previewDone" class="sel-count warn">待改进竞价共 {{ totalBidCount }} 条</span>
        </div>
        <el-table
          v-if="previewShops.length"
          :data="previewShops"
          size="small"
          border
          class="preview-table"
          row-key="shopId"
          :default-expand-all="false"
        >
          <el-table-column type="expand">
            <template #default="{ row }">
              <div v-if="row.items && row.items.length" class="expand-list">
                <div v-for="it in row.items" :key="it.bidId" class="expand-row">
                  <span class="e-name" :title="it.name">{{ it.name }}</span>
                  <span v-if="it.modelName" class="e-model">{{ it.modelName }}</span>
                  <span class="e-price">竞价价：{{ it.price }}</span>
                  <span v-if="it.suggestedPrice" class="e-suggest">建议：{{ it.suggestedPrice }}</span>
                </div>
              </div>
              <div v-else class="expand-empty">无待改进竞价</div>
            </template>
          </el-table-column>
          <el-table-column prop="name" label="店铺" min-width="150" />
          <el-table-column prop="shopId" label="店铺ID" width="120" />
          <el-table-column label="商品数" width="80" align="center">
            <template #default="{ row }">{{ row.itemCount }}</template>
          </el-table-column>
          <el-table-column label="待改进竞价" width="100" align="center">
            <template #default="{ row }">
              <span :class="row.ok && row.bidCount ? 'cnt-bad' : 'cnt-ok'">{{ row.bidCount }}</span>
            </template>
          </el-table-column>
          <el-table-column label="状态" width="90" align="center">
            <template #default="{ row }">
              <el-tag v-if="row.ok" type="success" size="small">成功</el-tag>
              <el-tag v-else type="danger" size="small">失败</el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="msg" label="备注" min-width="160" show-overflow-tooltip />
        </el-table>
      </el-card>

      <el-card shadow="never" class="card danger-card">
        <template #header>④ 撤销竞价（危险操作）</template>
        <div class="actions">
          <el-button type="danger" size="large" :disabled="selCount === 0" :loading="cancelling" @click="doCancel">
            {{ cancelling ? '撤销中…' : '撤销全部待改进竞价' }}
          </el-button>
          <span class="danger-tip">撤销后竞价立即失效，不可恢复！建议先执行第 ③ 步扫描确认。</span>
        </div>
        <div class="log-box">
          <LogPanel :lines="logLines" height="320px" />
        </div>
      </el-card>
    </div>
  </div>
</template>

<style scoped>
.danger-card { border: 1px solid #ffd2cc; }
.sel-count.warn { color: #d84315; font-weight: 600; }
.danger-tip { font-size: 13px; color: #c62828; flex: 1; min-width: 220px; }
.preview-table { margin-top: 14px; }
.expand-list { padding: 2px 10px 8px; }
.expand-row {
  display: flex;
  gap: 14px;
  align-items: center;
  padding: 6px 8px;
  border-bottom: 1px dashed #eee;
  font-size: 13px;
}
.e-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.e-model { color: #888; max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.e-price { color: #555; white-space: nowrap; }
.e-suggest { color: #d84315; white-space: nowrap; }
.expand-empty { color: #999; padding: 8px; }
.cnt-bad { color: #c62828; font-weight: 700; }
.cnt-ok { color: #2e7d32; }
/* .log-box 为全局类（styles/base.css） */
</style>
