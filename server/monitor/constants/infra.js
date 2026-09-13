'use strict';
// 监控基础设施常量：数据目录 / 快照保留与容量 / 告警与事件缓存上限。
const path = require('path');

// 数据目录：默认 server/data/monitor（gitignored，凭证不入库）；测试经 MONITOR_DATA_DIR 隔离。
const DATA_DIR = process.env.MONITOR_DATA_DIR || path.join(__dirname, '..', '..', 'data', 'monitor');
// 原始快照保留天数（周同比/滚动基线需要历史窗口）
const RETENTION_DAYS = 90;
// 单店单指标单日快照上限（防异常写入撑爆磁盘）
const SNAPSHOT_CAP_PER_DAY = 2000;
// 内存告警条数上限（超出时淘汰最旧的已关闭记录）
const ALERT_CAP = 500;
// SSE 事件回放缓存条数（迟到连接回放用，同 video/job.js 的思路）
const EVENT_LOG_CAP = 200;

module.exports = {
  DATA_DIR,
  RETENTION_DAYS,
  SNAPSHOT_CAP_PER_DAY,
  ALERT_CAP,
  EVENT_LOG_CAP,
};
