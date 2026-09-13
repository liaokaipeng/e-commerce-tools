'use strict';
// 告警级别定义与展示样式。
// 级别：P0 最严重（大屏红色脉冲置顶）、P1 重要、P2 提醒。
const LEVELS = ['P0', 'P1', 'P2'];
const LEVEL_ORDER = { P2: 1, P1: 2, P0: 3 };
const LEVEL_STYLE = {
  P0: { name: '紧急', color: '#FF3B30' },
  P1: { name: '重要', color: '#FF9500' },
  P2: { name: '提醒', color: '#FFD60A' },
};
const OK_COLOR = '#30D158';

module.exports = {
  LEVELS,
  LEVEL_ORDER,
  LEVEL_STYLE,
  OK_COLOR,
};
