'use strict';
// 告警级别定义：P0 最严重（大屏红色脉冲置顶）、P1 重要、P2 提醒。
// 展示样式（颜色等）由前端 monitor.css 自行定义，后端只保留级别语义与排序。
const LEVELS = ['P0', 'P1', 'P2'];
const LEVEL_ORDER = { P2: 1, P1: 2, P0: 3 };

/** 各级别零值计数对象（汇总/兜底用；由 LEVELS 生成，避免各处手写 P0/P1/P2 漂移） */
function zeroLevelCounts() {
  const out = {};
  for (const lv of LEVELS) out[lv] = 0;
  return out;
}

module.exports = {
  LEVELS,
  LEVEL_ORDER,
  zeroLevelCounts,
};
