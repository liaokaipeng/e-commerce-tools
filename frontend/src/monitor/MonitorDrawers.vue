<script setup>
// 两个右侧抽屉：告警规则编辑（阈值按人民币）与监控店铺配置（勾选需巡检的店铺）。
const rulesDrawer = defineModel('rulesDrawer', { type: Boolean });
const shopsDrawer = defineModel('shopsDrawer', { type: Boolean });
const shopSearch = defineModel('shopSearch', { type: String, default: '' });

defineProps({
  ruleEdits: { type: Array, default: () => [] },
  savingRules: { type: Boolean, default: false },
  shopConfig: { type: Array, default: () => [] },
  savingShops: { type: Boolean, default: false },
  shownShopConfig: { type: Array, default: () => [] },
  monitoredCount: { type: Number, default: 0 },
});

const emit = defineEmits(['save-rules', 'save-shops', 'set-all']);
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
</template>
