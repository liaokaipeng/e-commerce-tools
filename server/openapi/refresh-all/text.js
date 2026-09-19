'use strict';
// 批量刷新汇总文案（中文，前端直接展示）：与执行统计解耦，便于单测与复用。
const { REFRESH_COOLDOWN_MS } = require('../constants');

/** 汇总文案（中文，前端直接展示） */
function summaryText({ refreshed, failed, skippedShops, cooled }) {
  const parts = [`批量刷新完成：成功 ${refreshed} 个店铺`];
  if (cooled) parts.push(`其中 ${cooled} 个距上次刷新不足 ${Math.round(REFRESH_COOLDOWN_MS / 60000)} 分钟，已跳过重复刷新`);
  if (failed) parts.push(`失败 ${failed} 个`);
  if (skippedShops) parts.push(`跳过 ${skippedShops} 个店铺（需重新授权，见列表状态）`);
  return parts.join('，');
}

module.exports = { summaryText };
