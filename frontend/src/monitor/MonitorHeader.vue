<script setup>
// 顶栏：标题 + 统计卡 + 控制项 + 时钟；授权失效时在下方提示重新授权横幅。
import { fmtClock } from './constants.js';

// 三个开关双向绑定（投影 / 声音 / 轮播）
const projectMode = defineModel('projectMode', { type: Boolean });
const soundOn = defineModel('soundOn', { type: Boolean });
const rotateOn = defineModel('rotateOn', { type: Boolean });

defineProps({
  overview: { type: Object, required: true },
  normalCount: { type: Number, default: 0 },
  reAuthCount: { type: Number, default: 0 },
  sseOk: { type: Boolean, default: false },
  now: { type: Number, default: 0 },
});

const emit = defineEmits(['currency-change', 'manual-collect', 'open-shops', 'open-rules', 'reauth']);
</script>

<template>
  <header class="top">
    <div class="title">
      <span class="logo">S</span>
      <div>
        <b>虾皮跨境店监控大屏</b>
        <small>多店巡检 · 三级告警 · 数据仅存本机</small>
      </div>
    </div>
    <div class="stats">
      <div class="stat"><b>{{ overview.shops.length }}</b><span>店铺</span></div>
      <div class="stat p0" :class="{ pulse: overview.totals.P0 > 0 }"><b>{{ overview.totals.P0 }}</b><span>P0 紧急</span></div>
      <div class="stat p1"><b>{{ overview.totals.P1 }}</b><span>P1 重要</span></div>
      <div class="stat p2"><b>{{ overview.totals.P2 }}</b><span>P2 提醒</span></div>
      <div class="stat ok"><b>{{ normalCount }}</b><span>正常</span></div>
      <div v-if="overview.excludedCount > 0" class="stat dim clickable" @click="emit('open-shops')" title="已授权但未启用监控的店铺数，点击配置">
        <b>{{ overview.excludedCount }}</b><span>未监控</span>
      </div>
      <div v-if="reAuthCount > 0" class="stat reauth"><b>{{ reAuthCount }}</b><span>待重新授权</span></div>
    </div>
    <div class="controls">
      <span class="ctl" title="金额指标展示单位（告警规则阈值始终按人民币配置与比较）">金额
        <el-select v-model="overview.currencyMode" size="small" class="cur-sel" @change="emit('currency-change')">
          <el-option label="当地货币" value="local" />
          <el-option label="人民币" value="rmb" />
        </el-select>
      </span>
      <span class="ctl" title="投屏/展示模式"><el-switch v-model="projectMode" size="small" />投影</span>
      <span class="ctl" title="P0 告警声音提醒"><el-switch v-model="soundOn" size="small" />声音</span>
      <span class="ctl" title="投影模式下每 20 秒轮换店铺"><el-switch v-model="rotateOn" size="small" />轮播</span>
      <el-button size="small" title="立即采集所选店铺（未选择时全部店铺）" @click="emit('manual-collect')">立即采集</el-button>
      <el-button size="small" title="勾选哪些已授权店铺需要监控（未勾选的不采集、不进大屏）" @click="emit('open-shops')">监控店铺</el-button>
      <el-button size="small" @click="emit('open-rules')">告警规则</el-button>
    </div>
    <div class="clock">
      <b>{{ fmtClock(now) }}</b>
      <small :class="{ on: sseOk }">{{ sseOk ? '实时推送' : '轮询中' }}</small>
    </div>
  </header>

  <!-- 授权失效横幅：这些店铺已暂停采集，重新授权后自动恢复 -->
  <div v-if="reAuthCount > 0" class="reauth-banner">
    <span class="rb-ico">⚠</span>
    <span><b>{{ reAuthCount }}</b> 家店铺的开放平台授权已失效（主账号共享 token 被刷新绑定或已过期），已自动暂停这些店铺的采集。
      到「开放平台」页用<b>主账号重新授权一次</b>即可全部恢复，无需逐店操作。</span>
    <el-button type="danger" size="small" class="rb-btn" @click="emit('reauth')">去重新授权</el-button>
  </div>
</template>
