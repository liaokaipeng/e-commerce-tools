<script setup>
// 左栏：店铺健康墙。按告警级别置顶排序（排序由父组件完成），点击卡片切换当前店铺。
// 自带店铺搜索（店名 / 店铺ID），并展示每店「最高告警」摘要，便于多店快速定位。
import { ref, computed } from 'vue';
import { LEVEL_COLOR, OK_COLOR, DOMAIN_LABEL, shopName, fmtTime } from './constants.js';

const props = defineProps({
  shops: { type: Array, default: () => [] },
  selectedShop: { type: String, default: '' },
  // 每店最高优先级的未关闭告警（shopId -> alert），用于「最高告警」摘要
  topAlert: { type: Object, default: () => ({}) },
});

const emit = defineEmits(['select']);

const search = ref('');

/** 按关键词过滤（店名 / 店铺ID，大小写不敏感，空格分隔多关键词需同时命中） */
const shownShops = computed(() => {
  const kws = search.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!kws.length) return props.shops;
  return props.shops.filter((s) => {
    const hay = `${s.name || ''} ${s.shopId}`.toLowerCase();
    return kws.every((k) => hay.includes(k));
  });
});
</script>

<template>
  <aside class="panel shops">
    <h3>店铺健康墙 <small>按告警级别自动置顶</small></h3>
    <div class="shop-search">
      <el-input
        v-model="search"
        size="small"
        clearable
        placeholder="搜索店铺名 / 店铺ID"
        @keydown.esc="search = ''"
      />
      <span v-if="search.trim()" class="dim2">{{ shownShops.length }} / {{ shops.length }}</span>
    </div>
    <div class="shop-list">
      <div
        v-for="s in shownShops"
        :key="s.shopId"
        class="shop-card"
        :class="['lv-' + (s.authBroken ? 'reauth' : s.alerts.maxLevel || 'ok'), { selected: s.shopId === selectedShop }, { flashing: s.alerts.maxLevel === 'P0' && !s.authBroken }]"
        @click="emit('select', s.shopId)"
      >
        <div class="sc-head">
          <span class="dot" :style="{ background: s.authBroken ? '#8f95a8' : LEVEL_COLOR[s.alerts.maxLevel] || OK_COLOR }"></span>
          <b class="sc-name">{{ shopName(s) }}</b>
          <span class="sc-badges">
            <i v-if="s.authBroken" class="b-reauth" :title="'授权已失效，重新授权后自动恢复采集'">待重新授权</i>
            <template v-else>
              <i v-if="s.alerts.P0" class="b-P0">P0×{{ s.alerts.P0 }}</i>
              <i v-if="s.alerts.P1" class="b-P1">P1×{{ s.alerts.P1 }}</i>
              <i v-if="s.alerts.P2" class="b-P2">P2×{{ s.alerts.P2 }}</i>
              <i v-if="!s.alerts.maxLevel" class="b-ok">正常</i>
            </template>
          </span>
        </div>
        <div
          v-if="!s.authBroken && topAlert[s.shopId]"
          class="sc-top"
          :style="{ color: LEVEL_COLOR[topAlert[s.shopId].level] }"
          :title="'最高优先级告警：' + topAlert[s.shopId].title"
        >
          最高告警：{{ topAlert[s.shopId].title }}<i v-if="topAlert[s.shopId].count > 1"> ×{{ topAlert[s.shopId].count }}</i>
        </div>
        <div class="sc-foot" :title="s.lastError && Object.keys(s.lastError).length ? JSON.stringify(s.lastError) : ''">
          <span
            v-for="(label, dom) in DOMAIN_LABEL"
            :key="dom"
            :class="{ bad: s.failCount[dom], off: s.unsupported && s.unsupported[dom] }"
            :title="s.unsupported && s.unsupported[dom] ? '该域无权限/未开通，已跳过采集：' + s.unsupported[dom].reason : ''"
          >
            {{ label }}{{ s.unsupported && s.unsupported[dom] ? '—' : s.lastRun[dom] ? '✓' + fmtTime(s.lastRun[dom]) : s.failCount[dom] ? '✗' + s.failCount[dom] + '次' : '·' }}
          </span>
        </div>
      </div>
      <div v-if="shops.length && !shownShops.length" class="dim2 shop-empty">没有匹配「{{ search }}」的店铺</div>
    </div>
  </aside>
</template>
