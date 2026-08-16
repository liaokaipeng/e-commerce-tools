'use strict';
// 监控大屏金额换算：当地货币 ↔ 人民币。
// 口径约定：
//   - 规则面板的金额阈值一律按「人民币」配置与比较（评估时把原始值换算成人民币再比阈值）；
//   - 大屏金额展示全局可切换「当地货币（默认）/ 人民币」（config.json 的 currencyMode）；
//   - 采集快照/告警 current 一律存「当地货币原始值」，展示与比较时按需换算。
// 汇率来源：优先内存/磁盘缓存（24h 内有效），其次自动拉取免费 keyless 汇率接口
//   （open.er-api.com/v6/latest/CNY，无需注册），失败或离线回退内置静态汇率表（近似值，随版本更新）。
// 汇率在线刷新仅在「存在已授权店铺」时触发（无店铺空转不发外部请求，测试环境全程离线）。
const fs = require('fs');
const path = require('path');
const { request } = require('../lib/http');
const { DATA_DIR } = require('./constants');

// 内置静态汇率（1 单位当地货币 ≈ 多少人民币；近似值，仅作离线兜底，在线拉取成功后覆盖）
const STATIC_RMB_RATES = {
  CNY: 1,
  THB: 0.21, PHP: 0.13, IDR: 0.00046, VND: 0.00029, MYR: 1.56, SGD: 5.32,
  TWD: 0.232, HKD: 0.92, USD: 7.2, EUR: 7.85, GBP: 9.1, KRW: 0.0053, JPY: 0.048,
  BRL: 1.32, MXN: 0.42, CLP: 0.0077, COP: 0.0018, ARS: 0.0082, PLN: 1.8, INR: 0.086,
};

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

const RATES_FILE = path.join(DATA_DIR, 'rates.json');
const RATE_TTL_MS = 24 * 3600 * 1000; // 汇率缓存 24 小时
const RETRY_MS = 10 * 60 * 1000; // 在线拉取失败后 10 分钟内不重试

let liveRates = null; // { fetchedAt, rates: { CUR: 1 单位 = 人民币数 } }
let lastAttempt = 0;

/** 读磁盘缓存（24h 内有效），失败/过期返回 null */
function loadCachedRates() {
  try {
    if (!fs.existsSync(RATES_FILE)) return null;
    const j = JSON.parse(fs.readFileSync(RATES_FILE, 'utf8'));
    if (j && j.rates && typeof j.rates === 'object' && Date.now() - (j.fetchedAt || 0) < RATE_TTL_MS) return j;
    return null;
  } catch (e) {
    return null;
  }
}

function saveCachedRates(j) {
  try {
    fs.mkdirSync(path.dirname(RATES_FILE), { recursive: true });
    fs.writeFileSync(RATES_FILE, JSON.stringify(j));
  } catch (e) {
    console.warn('[监控] 保存汇率缓存失败:', e.message);
  }
}

/** 当前生效汇率表：内置表 + 在线/磁盘缓存覆盖（未知币种回退内置表，仍无则按 1:1） */
function currentRates() {
  const rates = Object.assign({}, STATIC_RMB_RATES);
  const live = liveRates || loadCachedRates();
  if (live) {
    for (const [k, v] of Object.entries(live.rates || {})) {
      if (typeof v === 'number' && isFinite(v) && v > 0) rates[k] = v;
    }
  }
  return rates;
}

/**
 * 在线拉取汇率（免费 keyless 接口，人民币为基准）：
 * open.er-api.com/v6/latest/CNY 返回 rates = 1 人民币可兑换的各币种数量，
 * 因此 1 单位外币 = 1 / rates[X] 人民币。
 */
async function fetchLiveRates() {
  const resp = await request({ method: 'GET', url: 'https://open.er-api.com/v6/latest/CNY', timeout: 10000 });
  const j = resp.json;
  if (!j || j.result !== 'success' || !j.rates || typeof j.rates !== 'object') {
    throw new Error('汇率接口返回异常（' + (resp.status || '') + '）');
  }
  const rates = { CNY: 1 };
  for (const [k, v] of Object.entries(j.rates)) {
    const n = Number(v);
    if (k && k.length === 3 && isFinite(n) && n > 0) {
      rates[k] = Math.round((1 / n) * 1e8) / 1e8;
    }
  }
  return { fetchedAt: Date.now(), rates };
}

/**
 * 懒加载刷新汇率：内存/磁盘缓存未过期直接返回；过期则后台拉取（失败静默回退内置表）。
 * 仅在有已授权店铺时调用（无店铺空转不发外部请求，测试环境全程离线）。
 */
function ensureRates() {
  if (liveRates && Date.now() - liveRates.fetchedAt < RATE_TTL_MS) return;
  const cached = loadCachedRates();
  if (cached) { liveRates = cached; return; }
  if (Date.now() - lastAttempt < RETRY_MS) return;
  lastAttempt = Date.now();
  fetchLiveRates()
    .then((fresh) => {
      liveRates = fresh;
      saveCachedRates(fresh);
      console.log(`[监控] 汇率已在线更新（${Object.keys(fresh.rates).length} 个币种，1 单位外币 → 人民币）`);
    })
    .catch((e) => console.warn('[监控] 汇率在线更新失败，回退内置静态汇率表：', e.message));
}

/** 当地货币 → 人民币（未知币种按 1:1 视为人民币，保守不换算） */
function toRmb(amount, currency) {
  if (typeof amount !== 'number' || !isFinite(amount)) return amount;
  const c = String(currency || 'CNY').toUpperCase();
  if (c === 'CNY') return amount;
  const r = currentRates()[c];
  if (!r) return amount;
  return amount * r;
}

/** 人民币 → 当地货币（未知币种按 1:1） */
function fromRmb(amount, currency) {
  if (typeof amount !== 'number' || !isFinite(amount)) return amount;
  const c = String(currency || 'CNY').toUpperCase();
  if (c === 'CNY') return amount;
  const r = currentRates()[c];
  if (!r) return amount;
  return amount / r;
}

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

// 汇率缓存每日自动续期（unref 不阻塞进程退出；无缓存时不主动拉取，由 ensureRates 在有店铺时触发）
const rateTimer = setInterval(() => {
  if (liveRates || loadCachedRates()) ensureRates();
}, 6 * 3600 * 1000);
if (rateTimer.unref) rateTimer.unref();

module.exports = {
  STATIC_RMB_RATES,
  REGION_CURRENCY,
  CURRENCY_SYMBOLS,
  ensureRates,
  toRmb,
  fromRmb,
  regionCurrency,
  symbolOf,
  roundMoney,
  moneyText,
  _test: { currentRates, loadCachedRates, fetchLiveRates },
};
