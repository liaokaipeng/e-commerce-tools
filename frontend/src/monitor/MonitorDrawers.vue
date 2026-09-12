<script setup>
// 右侧抽屉：告警规则编辑（阈值按人民币）/ 监控店铺配置（勾选需巡检的店铺）/ 告警详情（结构化明细清单）。
import { ref, computed, watch } from 'vue';
import { ElMessage } from 'element-plus';
import { LEVEL_COLOR, LEVEL_NAME, shopName, fmtTime } from './constants.js';

const rulesDrawer = defineModel('rulesDrawer', { type: Boolean });
const shopsDrawer = defineModel('shopsDrawer', { type: Boolean });
const shopSearch = defineModel('shopSearch', { type: String, default: '' });
const detailDrawer = defineModel('detailDrawer', { type: Boolean });

const props = defineProps({
  ruleEdits: { type: Array, default: () => [] },
  savingRules: { type: Boolean, default: false },
  shopConfig: { type: Array, default: () => [] },
  savingShops: { type: Boolean, default: false },
  shownShopConfig: { type: Array, default: () => [] },
  monitoredCount: { type: Number, default: 0 },
  detailAlert: { type: Object, default: null },
});

const emit = defineEmits(['save-rules', 'save-shops', 'set-all']);

// ---------- 告警详情抽屉 ----------
const detailSearch = ref('');

watch(() => props.detailAlert, () => { detailSearch.value = ''; });

const STATUS_TEXT = { open: '触发中', ack: '已确认', recovered: '已恢复', closed: '已关闭' };

function shopNameOf(shopId) {
  return shopName((props.shopConfig || []).find((s) => s.shopId === shopId))
    || shopNameOfCache(shopId);
}
// shopConfig 只含全部已授权店铺（含未监控），兜底直接给 ID 后四位
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
  try {
    await navigator.clipboard.writeText(text);
    ElMessage.success(`已复制 ${rows.length} 行明细`);
  } catch {
    ElMessage.error('复制失败，请手动选择表格内容复制');
  }
}
</script>

<template>
  <!-- 规则编辑抽屉（728px：560 放大 30%，避免规则表格出现横向滚动条） -->
  <el-drawer v-model="rulesDrawer" title="告警规则（阈值修改后立即生效）" size="728px" direction="rtl">
    <p class="dim2">值越大越严重（店铺评分为「越小越严重」）。留空的级别不触发。金额类规则阈值<b>一律按人民币</b>填写与比较（大屏展示可切换当地货币/人民币，告警自动换算）。</p>
    <el-table :data="ruleEdits" size="small" border class="rule-table">
      <el-table-column label="启用" width="60" align="center">
        <template #default="{ row }"><el-switch v-model="row.enabled" size="small" /></template>
      </el-table-column>
      <el-table-column label="规则" min-width="170">
        <template #default="{ row }">{{ row.title }}<i v-if="row.unit" class="dim2">（{{ row.unit }}）</i></template>
      </el-table-column>
      <el-table-column label="P2 提醒" width="112">
        <template #default="{ row }">
          <el-input-number v-model="row.p2" :controls="false" size="small" placeholder="不触发" class="num" :class="{ p2c: row.p2 !== null }" />
        </template>
      </el-table-column>
      <el-table-column label="P1 重要" width="112">
        <template #default="{ row }">
          <el-input-number v-model="row.p1" :controls="false" size="small" placeholder="不触发" class="num" :class="{ p1c: row.p1 !== null }" />
        </template>
      </el-table-column>
      <el-table-column label="P0 紧急" width="112">
        <template #default="{ row }">
          <el-input-number v-model="row.p0" :controls="false" size="small" placeholder="不触发" class="num" :class="{ p0c: row.p0 !== null }" />
        </template>
      </el-table-column>
    </el-table>
    <div class="drawer-ops">
      <el-button @click="rulesDrawer = false">取消</el-button>
      <el-button type="primary" :loading="savingRules" @click="emit('save-rules')">保存</el-button>
    </div>
  </el-drawer>

  <!-- 监控店铺配置抽屉 -->
  <el-drawer v-model="shopsDrawer" title="监控店铺配置" size="560px" direction="rtl">
    <p class="dim2">
      已授权的店铺默认全部监控；取消勾选的店铺<b>不再巡检采集、不出现在大屏</b>，其未关闭的告警会自动关闭。
      重新勾选后立即恢复采集，历史快照与告警记录仍保留。
    </p>
    <div class="shopcfg-search-row">
      <el-input
        v-model="shopSearch"
        class="shopcfg-search"
        size="small"
        clearable
        placeholder="搜索店铺名 / 店铺ID（空格分隔多关键词）"
        @keydown.esc="shopSearch = ''"
      />
      <span class="dim2 scfg-sum">{{ monitoredCount }} / {{ shopConfig.length }} 家监控中</span>
    </div>
    <div class="shopcfg-ops">
      <el-button size="small" @click="emit('set-all', true)">
        {{ shopSearch.trim() ? '匹配项全部监控' : '全部监控' }}
      </el-button>
      <el-button size="small" @click="emit('set-all', false)">
        {{ shopSearch.trim() ? '匹配项全部停用' : '全部停用' }}
      </el-button>
      <span v-if="shopSearch.trim()" class="dim2">当前操作只作用于 {{ shownShopConfig.length }} 家匹配店铺</span>
    </div>
    <div class="shopcfg-list">
      <label v-for="s in shownShopConfig" :key="s.shopId" class="shopcfg-row">
        <el-switch v-model="s.monitored" size="small" />
        <span class="scfg-name">{{ s.name || '店铺…' + String(s.shopId).slice(-4) }}</span>
        <i v-if="s.authBroken" class="b-reauth" title="授权已失效，重新授权后自动恢复采集">待重新授权</i>
        <i v-else class="scfg-state" :class="{ on: s.monitored }">{{ s.monitored ? '监控中' : '不监控' }}</i>
        <span class="scfg-id">{{ s.shopId }}</span>
      </label>
      <div v-if="!shopConfig.length" class="dim2">暂无已授权店铺，请先在「开放平台」Tab 完成 App 配置与店铺授权。</div>
      <div v-else-if="!shownShopConfig.length" class="dim2">没有匹配「{{ shopSearch }}」的店铺，换个关键词试试。</div>
    </div>
    <div class="drawer-ops">
      <el-button @click="shopsDrawer = false">取消</el-button>
      <el-button type="primary" :loading="savingShops" @click="emit('save-shops')">保存</el-button>
    </div>
  </el-drawer>

  <!-- 告警详情抽屉：生命周期信息 + 结构化明细清单（如断货商品 / 待发货订单 / 退货申请） -->
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
        <span v-if="detailAlert.recoveredAt">恢复于：{{ fmtTime(detailAlert.recoveredAt) }}</span>
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
