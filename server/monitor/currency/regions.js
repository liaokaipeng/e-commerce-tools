'use strict';
// 地区 ↔ 货币映射：店铺地区代码 → 当地货币代码，以及大屏金额展示用的币种符号。

// 店铺地区代码 → 当地货币（get_shop_info 返回的 region 字段；未知地区按人民币处理）
const REGION_CURRENCY = {
  CN: 'CNY', TH: 'THB', PH: 'PHP', ID: 'IDR', VN: 'VND', MY: 'MYR', SG: 'SGD',
  TW: 'TWD', HK: 'HKD', US: 'USD', GB: 'GBP', KR: 'KRW', JP: 'JPY', BR: 'BRL',
  MX: 'MXN', CL: 'CLP', CO: 'COP', AR: 'ARS', PL: 'PLN', IN: 'INR',
  ES: 'EUR', FR: 'EUR', IT: 'EUR', DE: 'EUR', NL: 'EUR',
};

// 币种显示符号（大屏金额展示用；没有符号的用代码兜底）
const CURRENCY_SYMBOLS = {
  CNY: '¥', THB: '฿', PHP: '₱', IDR: 'Rp', VND: '₫', MYR: 'RM', SGD: 'S$',
  TWD: 'NT$', HKD: 'HK$', USD: '$', EUR: '€', GBP: '£', KRW: '₩', JPY: '¥',
  BRL: 'R$', MXN: 'MX$', CLP: 'CLP$', COP: 'COP$', ARS: 'AR$', PLN: 'zł', INR: '₹',
};

/** 地区代码 → 当地货币代码（未知返回空串，调用方按人民币处理） */
function regionCurrency(region) {
  const r = String(region || '').trim().toUpperCase();
  return REGION_CURRENCY[r] || '';
}

/** 币种显示符号（无符号用代码） */
function symbolOf(currency) {
  const c = String(currency || 'CNY').toUpperCase();
  return CURRENCY_SYMBOLS[c] || c;
}

module.exports = { REGION_CURRENCY, CURRENCY_SYMBOLS, regionCurrency, symbolOf };
