<script setup>
// 监控店铺配置抽屉：勾选需巡检的店铺，保存后由后端持久化排除名单。
const shopsDrawer = defineModel('shopsDrawer', { type: Boolean });
const shopSearch = defineModel('shopSearch', { type: String, default: '' });

defineProps({
  shopConfig: { type: Array, default: () => [] },
  savingShops: { type: Boolean, default: false },
  shownShopConfig: { type: Array, default: () => [] },
  monitoredCount: { type: Number, default: 0 },
});

const emit = defineEmits(['save-shops', 'set-all']);
</script>

<template>
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
