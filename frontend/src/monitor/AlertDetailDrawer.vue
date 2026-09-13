<script setup>
// 告警详情抽屉：生命周期信息 + 结构化明细清单（如断货商品 / 待发货订单 / 退货申请）。
import { ref, computed, watch } from 'vue';
import { ElMessage } from 'element-plus';
import { LEVEL_COLOR, LEVEL_NAME, fmtTime } from './constants.js';
import { copyText } from '../utils/clipboard.js';

const detailDrawer = defineModel('detailDrawer', { type: Boolean });

const props = defineProps({
  detailAlert: { type: Object, default: null },
  // 大屏总览的店铺列表（含真实店铺名）：未打开过「监控店铺」抽屉时也能显示店名
  shops: { type: Array, default: () => [] },
  shopConfig: { type: Array, default: () => [] },
});

// ---------- 明细清单 ----------
const detailSearch = ref('');

watch(() => props.detailAlert, () => { detailSearch.value = ''; });

const STATUS_TEXT = { open: '触发中', ack: '已确认', closed: '已关闭' };

function shopNameOf(shopId) {
  if (!shopId) return '';
  // 优先用大屏总览的店铺列表（始终有数据），其次监控店铺配置，最后兜底 ID 后四位
  const found = (props.shops || []).find((s) => s.shopId === shopId)
    || (props.shopConfig || []).find((s) => s.shopId === shopId);
  if (found && found.name) return found.name;
  return shopNameOfCache(shopId);
}
// 店铺名缺失时兜底给 ID 后四位
function shopNameOfCache(shopId) {
  return shopId ? '店铺…' + String(shopId).slice(-4) : '';
}

/** 明细行（按关键词过滤：ID / 主内容 / 补充信息，大小写不敏感） */
const detailRows = computed(() => {
  const rows = (props.detailAlert && props.detailAlert.detailRows) || [];
  const kw = detailSearch.value.trim().toLowerCase();
  if (!kw) return rows;
  return rows.filter((r) => `${r.id} ${r.title} ${r.sub}`.toLowerCase().includes(kw));
});

/** 复制明细清单（制表符分隔，可直接贴进表格/群聊） */
async function copyRows() {
  const rows = detailRows.value;
  if (!rows.length) return;
  const text = rows.map((r) => [r.id, r.title, r.sub].filter(Boolean).join('\t')).join('\n');
  if (await copyText(text)) ElMessage.success(`已复制 ${rows.length} 行明细`);
  else ElMessage.error('复制失败，请手动选择表格内容复制');
}
</script>

<template>
  <el-drawer v-model="detailDrawer" title="告警详情" size="560px" direction="rtl">
    <template v-if="detailAlert">
      <div class="ad-head">
        <i class="ai-level" :style="{ background: LEVEL_COLOR[detailAlert.level] || '#5b6272' }">
          {{ detailAlert.level }} {{ LEVEL_NAME[detailAlert.level] || '' }}
        </i>
        <b>{{ detailAlert.title }}</b>
        <span class="dim2">{{ shopNameOf(detailAlert.shopId) }}</span>
      </div>
      <div class="ad-meta">
        <span>状态：<b>{{ STATUS_TEXT[detailAlert.status] || detailAlert.status }}</b></span>
        <span>当前值：<b>{{ detailAlert.current }}{{ detailAlert.unit || '' }}</b></span>
        <span>累计触发 {{ detailAlert.count || 1 }} 次</span>
        <span>首次触发：{{ fmtTime(detailAlert.firstAt) }}</span>
        <span>最近触发：{{ fmtTime(detailAlert.lastAt) }}</span>
      </div>
      <div class="ad-msg">{{ detailAlert.message }}</div>
      <div v-if="detailAlert.suggest" class="ad-suggest">💡 {{ detailAlert.suggest }}</div>

      <template v-if="(detailAlert.detailRows || []).length">
        <div class="ad-rows-head">
          <b>明细清单（{{ detailRows.length }} / {{ detailAlert.detailRows.length }}）</b>
          <div class="ad-rows-ops">
            <el-input
              v-model="detailSearch"
              size="small"
              clearable
              placeholder="搜索 ID / 内容"
              class="ad-search"
              @keydown.esc="detailSearch = ''"
            />
            <el-button size="small" :disabled="!detailRows.length" @click="copyRows">复制</el-button>
          </div>
        </div>
        <el-table :data="detailRows" size="small" border class="ad-table" height="420">
          <el-table-column label="ID" width="130" show-overflow-tooltip>
            <template #default="{ row }">{{ row.id || '—' }}</template>
          </el-table-column>
          <el-table-column label="主内容" min-width="150" show-overflow-tooltip>
            <template #default="{ row }">{{ row.title || '—' }}</template>
          </el-table-column>
          <el-table-column label="补充信息" min-width="180" show-overflow-tooltip>
            <template #default="{ row }">{{ row.sub || '—' }}</template>
          </el-table-column>
        </el-table>
        <p v-if="detailAlert.detailRows.length >= 200" class="dim2">明细过多，仅保留最新前 200 条，完整清单请以卖家中心为准。</p>
      </template>
      <div v-else class="dim2 ad-none">该告警暂无结构化明细清单（指标为汇总口径，或下次采集后生成）。</div>
    </template>
  </el-drawer>
</template>
