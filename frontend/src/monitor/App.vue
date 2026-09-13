<script setup>
// 虾皮多店监控大屏（一期）—— 页面编排层。
// 数据流：GET /api/monitor/overview（总览+矩阵定级）/alerts（告警流）/trend（趋势）/rules（规则）
//         + /api/monitor/events SSE 实时推送（告警变更/采集结果，迟到回放），30s 兜底轮询。
// 告警只在本页展示（本期不接 IM）：P0 红色脉冲置顶 + 声音提醒，P1 橙色，P2 黄色。
//
// 分工：数据层由 useMonitor.js 编排（状态/数据/SSE/心跳/规则/店铺拆到 useMonitor*.js），
//       展示拆到同目录各子组件，常量/纯函数在 constants.js，趋势图 option 在 trend-chart.js，样式在 monitor.css。
import { useMonitor } from './useMonitor.js';
import MonitorHeader from './MonitorHeader.vue';
import ShopWall from './ShopWall.vue';
import TrendPanel from './TrendPanel.vue';
import MetricMatrix from './MetricMatrix.vue';
import AlertStream from './AlertStream.vue';
import MonitorFooter from './MonitorFooter.vue';
import RulesDrawer from './RulesDrawer.vue';
import ShopConfigDrawer from './ShopConfigDrawer.vue';
import AlertDetailDrawer from './AlertDetailDrawer.vue';

const {
  overview, alerts, trend, now,
  selectedShop, selectedMetric, filterLevel,
  projectMode, soundOn, rotateOn, sseOk, flashIds, initialLoading,
  trendDays, trendCompare,
  rulesDrawer, ruleEdits, savingRules, ruleSuggestions, loadingSuggestions,
  shopsDrawer, shopConfig, savingShops, shopSearch,
  detailDrawer, detailAlert,
  sortedShops, normalCount, reAuthCount, topAlertByShop,
  openTopAlerts, openCount, tickerText, metricChips,
  selectedShopObj, selectedFail, shownShopConfig, monitoredCount,
  selectShop, selectMetric, setTrendDays, toggleTrendCompare,
  openRules, saveRules, applySuggestion,
  openShopsConfig, setAllMonitored, saveShopsConfig,
  saveCurrencyMode, manualCollect, alertAction, batchAlertAction, goOpenapi, openAlertDetail,
} = useMonitor();</script>

<template>
  <div class="dash" :class="{ proj: projectMode }">
    <!-- ===== 顶栏：统计卡 + 控制 ===== -->
    <MonitorHeader
      v-model:projectMode="projectMode"
      v-model:soundOn="soundOn"
      v-model:rotateOn="rotateOn"
      :overview="overview"
      :normal-count="normalCount"
      :re-auth-count="reAuthCount"
      :sse-ok="sseOk"
      :now="now"
      @currency-change="saveCurrencyMode"
      @manual-collect="manualCollect"
      @open-shops="openShopsConfig"
      @open-rules="openRules"
      @reauth="goOpenapi"
    />

    <!-- 首次加载骨架屏：避免「空态一闪」造成误判 -->
    <div v-if="initialLoading" class="boot">
      <div class="boot-col">
        <div v-for="i in 4" :key="'a' + i" class="sk sk-card"></div>
      </div>
      <div class="boot-col">
        <div class="sk sk-chart"></div>
        <div class="sk sk-matrix"></div>
      </div>
      <div class="boot-col">
        <div v-for="i in 5" :key="'b' + i" class="sk sk-card"></div>
      </div>
    </div>

    <div v-else-if="!overview.configured || !overview.shops.length" class="empty">
      <el-empty :image-size="110">
        <template #description>
          <template v-if="!overview.configured">
            <h2>尚未配置开放平台 App</h2>
            <p>请先到门户页「开放平台」Tab 完成 App 配置与店铺授权，本大屏会自动开始巡检采集。</p>
          </template>
          <template v-else-if="overview.excludedCount > 0">
            <h2>当前没有启用监控的店铺</h2>
            <p>已授权 {{ overview.excludedCount }} 家店铺，但都被停用了监控。请在「监控店铺」中勾选需要巡检的店铺。</p>
          </template>
          <template v-else>
            <h2>当前没有已授权店铺</h2>
            <p>请先到门户页「开放平台」Tab 完成 App 配置与店铺授权，本大屏会自动开始巡检采集。</p>
          </template>
        </template>
        <el-button v-if="overview.configured && overview.excludedCount > 0" type="primary" size="small" @click="openShopsConfig">
          配置监控店铺
        </el-button>
      </el-empty>
      <p class="dim2">授权后无需任何额外设置：打开本页即开始按需巡检（订单履约 10 分钟 / 商品库存 30 分钟 / 账户健康·广告·资金·售后评价 60 分钟），离开本页自动暂停采集。</p>
    </div>

    <!-- ===== 主体三栏 ===== -->
    <main v-else class="grid">
      <!-- 左：店铺健康墙 -->
      <ShopWall
        :shops="sortedShops"
        :selected-shop="selectedShop"
        :top-alert="topAlertByShop"
        @select="selectShop"
      />

      <!-- 中：趋势 + 矩阵 -->
      <section class="center">
        <TrendPanel
          :selected-shop-obj="selectedShopObj"
          :selected-metric="selectedMetric"
          :metric-chips="metricChips"
          :selected-fail="selectedFail"
          :trend="trend"
          :trend-days="trendDays"
          :trend-compare="trendCompare"
          @select-metric="selectMetric"
          @select-days="setTrendDays"
          @toggle-compare="toggleTrendCompare"
        />
        <MetricMatrix
          :shops="sortedShops"
          :selected-shop="selectedShop"
          :metric-chips="metricChips"
          @select-shop="selectShop"
          @select-metric="selectMetric"
        />
      </section>

      <!-- 右：告警流 -->
      <AlertStream
        v-model:filterLevel="filterLevel"
        :alerts="alerts"
        :open-count="openCount"
        :shops="overview.shops"
        :flash-ids="flashIds"
        :now="now"
        @action="alertAction"
        @detail="openAlertDetail"
        @batch-action="batchAlertAction"
      />
    </main>

    <!-- ===== 底部：跑马灯 + 采集状态 ===== -->
    <MonitorFooter :overview="overview" :ticker-text="tickerText" :open-top-alerts="openTopAlerts" />

    <!-- ===== 规则 / 监控店铺 / 告警详情抽屉 ===== -->
    <RulesDrawer
      v-model:rulesDrawer="rulesDrawer"
      :rule-edits="ruleEdits"
      :saving-rules="savingRules"
      :rule-suggestions="ruleSuggestions"
      :loading-suggestions="loadingSuggestions"
      @save-rules="saveRules"
      @apply-suggestion="applySuggestion"
    />
    <ShopConfigDrawer
      v-model:shopsDrawer="shopsDrawer"
      v-model:shopSearch="shopSearch"
      :shop-config="shopConfig"
      :saving-shops="savingShops"
      :shown-shop-config="shownShopConfig"
      :monitored-count="monitoredCount"
      @save-shops="saveShopsConfig"
      @set-all="setAllMonitored"
    />
    <AlertDetailDrawer
      v-model:detailDrawer="detailDrawer"
      :detail-alert="detailAlert"
      :shops="overview.shops"
      :shop-config="shopConfig"
    />
  </div>
</template>
