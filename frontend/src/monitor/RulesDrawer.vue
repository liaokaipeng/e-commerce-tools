<script setup>
// 告警规则编辑抽屉：阈值按人民币填写，历史建议只读展示，采用需手动保存。

const rulesDrawer = defineModel('rulesDrawer', { type: Boolean });

const props = defineProps({
  ruleEdits: { type: Array, default: () => [] },
  savingRules: { type: Boolean, default: false },
  // 阈值分位数建议（ruleId -> { samples, hitRate, flat, suggest }），只读展示，采用需用户手动确认
  ruleSuggestions: { type: Object, default: () => ({}) },
  loadingSuggestions: { type: Boolean, default: false },
});

const emit = defineEmits(['save-rules', 'apply-suggestion']);

const sugOf = (id) => props.ruleSuggestions[id] || null;
const fmtSug = (s) => (s && s.suggest ? `P2 ${s.suggest.p2} / P1 ${s.suggest.p1} / P0 ${s.suggest.p0}` : '');
/** 建议不可用时的原因文案（样本不足 / 数据无波动） */
function sugEmptyText(s) {
  if (!s) return '暂无建议';
  return s.samples < 20 ? '样本不足，暂无建议' : '数据无波动或仅 0 值，暂无建议';
}
</script>

<template>
  <!-- 规则编辑抽屉（728px：560 放大 30%，避免规则表格出现横向滚动条） -->
  <el-drawer v-model="rulesDrawer" title="告警规则（阈值修改后立即生效）" size="728px" direction="rtl">
    <p class="dim2">值越大越严重（店铺评分为「越小越严重」）。留空的级别不触发。金额类规则阈值<b>一律按人民币</b>填写与比较（大屏展示可切换当地货币/人民币，告警自动换算）。<br>「历史建议」按最近 30 天样本的分位数给出，仅作参考；点「采用」只填入输入框，仍需点「保存」才生效。</p>
    <el-table :data="ruleEdits" size="small" border class="rule-table">
      <el-table-column label="启用" width="60" align="center">
        <template #default="{ row }"><el-switch v-model="row.enabled" size="small" /></template>
      </el-table-column>
      <el-table-column label="规则 / 历史建议" min-width="200">
        <template #default="{ row }">
          <div>{{ row.title }}<i v-if="row.unit" class="dim2">（{{ row.unit }}）</i></div>
          <div v-if="loadingSuggestions" class="r-sug dim2">建议计算中…</div>
          <div v-else-if="sugOf(row.id) && sugOf(row.id).suggest" class="r-sug">
            <span class="r-sug-val">{{ fmtSug(sugOf(row.id)) }}</span>
            <a class="r-sug-apply" @click="emit('apply-suggestion', row.id)">采用</a>
            <span
              v-if="sugOf(row.id).hitRate !== null && sugOf(row.id).hitRate >= 50"
              class="r-sug-warn"
              :title="'当前阈值在最近 30 天样本中有 ' + sugOf(row.id).hitRate + '% 的时间处于触发态，可能过于敏感'"
            >阈值偏敏感（命中 {{ sugOf(row.id).hitRate }}%）</span>
          </div>
          <div v-else class="r-sug dim2">{{ sugOf(row.id) ? sugEmptyText(sugOf(row.id)) : '暂无建议' }}</div>
        </template>
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
</template>
