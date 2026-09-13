'use strict';
// 汇率数据源与缓存：内置静态表兜底，优先内存/磁盘缓存（24h），过期后在线拉取免费 keyless 接口。
// 口径：汇率一律表示「1 单位当地货币 ≈ 多少人民币」。
const fs = require('fs');
const path = require('path');
const { request } = require('../../lib/http');
const { DATA_DIR } = require('../constants');

// 内置静态汇率（1 单位当地货币 ≈ 多少人民币；近似值，仅作离线兜底，在线拉取成功后覆盖）
const STATIC_RMB_RATES = {
  CNY: 1,
  THB: 0.21, PHP: 0.13, IDR: 0.00046, VND: 0.00029, MYR: 1.56, SGD: 5.32,
  TWD: 0.232, HKD: 0.92, USD: 7.2, EUR: 7.85, GBP: 9.1, KRW: 0.0053, JPY: 0.048,
  BRL: 1.32, MXN: 0.42, CLP: 0.0077, COP: 0.0018, ARS: 0.0082, PLN: 1.8, INR: 0.086,
};

const RATES_FILE = path.join(DATA_DIR, 'rates.json');
const RATE_TTL_MS = 24 * 3600 * 1000; // 汇率缓存 24 小时
const RETRY_MS = 10 * 60 * 1000; // 在线拉取失败后 10 分钟内不重试

let liveRates = null; // { fetchedAt, rates: { CUR: 1 单位 = 人民币数 } }
let lastAttempt = 0;

/** 读磁盘缓存（24h 内有效），失败/过期返回 null */
let loadCachedRates = function () {
  try {
    if (!fs.existsSync(RATES_FILE)) return null;
    const j = JSON.parse(fs.readFileSync(RATES_FILE, 'utf8'));
    if (j && j.rates && typeof j.rates === 'object' && Date.now() - (j.fetchedAt || 0) < RATE_TTL_MS) return j;
    return null;
  } catch (e) {
    return null;
  }
};

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

/** 清空汇率缓存（内存 + 磁盘），供缓存清理调用；下次需要时重新在线拉取 */
function clearRateCache() {
  liveRates = null;
  lastAttempt = 0;
  try {
    fs.rmSync(RATES_FILE, { force: true });
  } catch (e) {
    console.warn('[监控] 清空汇率缓存失败:', e.message);
  }
}

/** 汇率缓存状态（缓存清理面板展示用） */
function ratesInfo() {
  const live = liveRates || loadCachedRates();
  return { cached: !!live, fetchedAt: (live && live.fetchedAt) || 0 };
}

/**
 * 起测前把汇率表钉死在内置静态表（离线快照），并屏蔽磁盘缓存与在线拉取。
 * 供单元测试使用：金额阈值用例断言「500 泰铢 ≈ 105 元」这类具体数值，
 * 若放任在线汇率生效，断言会随当日真实汇率漂移而随机失败。
 * 生产代码不调用本函数（仅测试显式调用）。
 */
function lockStaticRatesForTest() {
  liveRates = null;
  loadCachedRates = () => null;   // 覆盖为永远返回 null：不读磁盘缓存
  lastAttempt = Date.now();       // 落在 RETRY_MS 窗口内：ensureRates 不发外部请求
}

// 汇率缓存每日自动续期（unref 不阻塞进程退出；无缓存时不主动拉取，由 ensureRates 在有店铺时触发）
const rateTimer = setInterval(() => {
  if (liveRates || loadCachedRates()) ensureRates();
}, 6 * 3600 * 1000);
if (rateTimer.unref) rateTimer.unref();

module.exports = {
  STATIC_RMB_RATES,
  currentRates,
  ensureRates,
  clearRateCache,
  ratesInfo,
  _test: { currentRates, loadCachedRates, fetchLiveRates, lockStaticRatesForTest },
};
