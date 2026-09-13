'use strict';
// 监控大屏常量入口：数据目录 / 告警级别 / 采集任务定义 / 指标目录 / 默认规则。
// 原本单文件混杂多类常量，现按类别拆到 constants/ 子目录，本入口只做聚合导出（对外 API 不变）。
const infra = require('./constants/infra');
const levels = require('./constants/levels');
const jobs = require('./constants/jobs');
const metrics = require('./constants/metrics');
const rulesData = require('./constants/rules-data');

module.exports = {
  // 基础设施常量（constants/infra.js）
  DATA_DIR: infra.DATA_DIR,
  RETENTION_DAYS: infra.RETENTION_DAYS,
  SNAPSHOT_CAP_PER_DAY: infra.SNAPSHOT_CAP_PER_DAY,
  ALERT_CAP: infra.ALERT_CAP,
  EVENT_LOG_CAP: infra.EVENT_LOG_CAP,
  // 告警级别与展示样式（constants/levels.js）
  LEVELS: levels.LEVELS,
  LEVEL_ORDER: levels.LEVEL_ORDER,
  LEVEL_STYLE: levels.LEVEL_STYLE,
  OK_COLOR: levels.OK_COLOR,
  // 采集任务定义（constants/jobs.js）
  JOBS: jobs.JOBS,
  // 指标目录与展示列（constants/metrics.js）
  METRICS: metrics.METRICS,
  isMoneyMetric: metrics.isMoneyMetric,
  MATRIX_METRICS: metrics.MATRIX_METRICS,
  // 默认规则数据（constants/rules-data.js）
  DEFAULT_RULES: rulesData.DEFAULT_RULES,
  RULES_BY_ID: rulesData.RULES_BY_ID,
};
