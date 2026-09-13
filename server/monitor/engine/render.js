'use strict';
// 告警展示渲染：明细归一化、告警消息生成（金额按全局模式换算）、按模式重渲染。
const { METRICS, isMoneyMetric } = require('../constants');
const { toRmb, moneyText } = require('../currency');
const store = require('../store');

// 单条告警结构化明细行数上限（防止异常数据撑爆内存 / alerts.json / 接口响应）
const DETAIL_ROWS_CAP = 200;

/**
 * 归一化告警明细：兼容两种形态——
 * - 旧：纯文本字符串（只拼消息，无明细行）
 * - 新：{ text, rows }，text 拼进告警消息，rows 为结构化明细行 [{ id, title, sub }] 供大屏「详情」抽屉展示
 */
function normalizeDetail(d) {
  if (d == null) return { text: '', rows: [] };
  if (typeof d === 'string') return { text: d, rows: [] };
  if (typeof d !== 'object') return { text: String(d), rows: [] };
  const rows = Array.isArray(d.rows)
    ? d.rows
      .filter((r) => r && typeof r === 'object')
      .slice(0, DETAIL_ROWS_CAP)
      .map((r) => ({
        id: String(r.id == null ? '' : r.id),
        title: String(r.title == null ? '' : r.title),
        sub: String(r.sub == null ? '' : r.sub),
      }))
    : [];
  return { text: String(d.text || ''), rows };
}

function msgOf(alert) {
  if (alert.domain === 'system') return alert.message || '采集异常';
  const m = METRICS[alert.metric] || {};
  const unit = alert.unit || m.unit || '';
  // 金额指标：按当前全局模式展示（当地货币原始值 / 换算人民币）
  if (isMoneyMetric(alert.metric)) {
    return `当前 ${moneyText(alert.current, shopCurrency(alert.shopId), store.getCurrencyMode())}，触发 ${alert.level} 阈值`;
  }
  return `当前 ${alert.current}${unit}，触发 ${alert.level} 阈值`;
}

/** 店铺当地货币（未识别按人民币处理） */
function shopCurrency(shopId) {
  const meta = store.getMeta();
  const m = (meta.shops && meta.shops[shopId]) || {};
  return String(m.currency || 'CNY');
}

/** 规则比较值：金额指标按人民币阈值比较，先换算；其余指标原值 */
function compareValue(metricId, v, shopId) {
  if (isMoneyMetric(metricId)) return toRmb(v, shopCurrency(shopId));
  return v;
}

/**
 * 告警消息 + 结构化明细回填：基础消息 + 可选明细文本（如「明细 违禁商品2/假冒商品1」），
 * 并把结构化明细行写入 alert.detailRows（本次采集未提供该指标明细时清空，避免残留旧清单）。
 */
function applyDetail(alert, details) {
  const d = normalizeDetail(details && details[alert.metric]);
  // 明细文本单独存一份：/api/monitor/alerts 路由按金额模式重渲染消息时保留明细（msgOf 只产出基础文案）
  alert.detailText = d.text;
  alert.message = d.text ? msgOf(alert) + '；' + d.text : msgOf(alert);
  alert.detailRows = d.rows;
}

/**
 * 按当前金额单位模式重渲染告警消息（金额指标随模式切换换算；路由层读取告警时调用）：
 * 基础文案重新生成，明细文本（detailText，不随模式变化）原样保留；
 * 旧落盘记录没有 detailText 字段时保持原 message 不动（可能已含明细文本）。
 */
function renderAlertMessage(a) {
  const base = msgOf(a);
  if (a.detailText != null) return a.detailText ? base + '；' + a.detailText : base;
  return a.message || base;
}

module.exports = {
  normalizeDetail,
  msgOf,
  shopCurrency,
  compareValue,
  applyDetail,
  renderAlertMessage,
};
