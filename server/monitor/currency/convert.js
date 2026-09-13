'use strict';
// 金额换算与展示格式化：当地货币 ↔ 人民币，及四舍五入/展示文本。
// 规则阈值一律按人民币比较与配置，故评估时先 toRmb；展示按全局模式选择原始值或换算值。
const rates = require('./rates');
const { symbolOf } = require('./regions');

/** 当地货币 → 人民币（未知币种按 1:1 视为人民币，保守不换算） */
function toRmb(amount, currency) {
  if (typeof amount !== 'number' || !isFinite(amount)) return amount;
  const c = String(currency || 'CNY').toUpperCase();
  if (c === 'CNY') return amount;
  const r = rates.currentRates()[c];
  if (!r) return amount;
  return amount * r;
}

/** 人民币 → 当地货币（未知币种按 1:1） */
function fromRmb(amount, currency) {
  if (typeof amount !== 'number' || !isFinite(amount)) return amount;
  const c = String(currency || 'CNY').toUpperCase();
  if (c === 'CNY') return amount;
  const r = rates.currentRates()[c];
  if (!r) return amount;
  return amount / r;
}

/** 金额显示值四舍五入到分（展示用） */
function roundMoney(v) {
  return Math.round(v * 100) / 100;
}

/**
 * 金额展示文本：mode='local' 显示当地货币原始值（如「123.45 ฿」），
 * mode='rmb' 换算成人民币（如「123.45 元」）。
 */
function moneyText(amount, currency, mode) {
  const c = String(currency || 'CNY').toUpperCase();
  const v = mode === 'rmb' ? toRmb(amount, c) : amount;
  if (typeof v !== 'number' || !isFinite(v)) return '—';
  const n = roundMoney(v);
  return mode === 'rmb' ? `${n} 元` : `${n} ${symbolOf(c)}`;
}

module.exports = { toRmb, fromRmb, roundMoney, moneyText };
