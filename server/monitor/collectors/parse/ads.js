'use strict';
// 广告域解析（纯函数）：小时级表现聚合与账户余额。
const { round2 } = require('./common');

/**
 * 广告小时级表现归一化（纯函数）：response 为单日小时数组（官方无分页、单日一次返回），
 * 聚合 花费=Σexpense、成交额=Σdirect_gmv、点击=Σclicks；
 * ROAS=成交额/花费（花费为 0 时 null）、CPC=花费/点击（点击为 0 时 null，官方无独立 CPC 字段）。
 */
function normalizeAdsHourly(list) {
  let spend = 0;
  let revenue = 0;
  let clicks = 0;
  let has = false;
  for (const it of list || []) {
    if (!it || typeof it !== 'object') continue;
    const e = Number(it.expense);
    const g = Number(it.direct_gmv);
    const c = Number(it.clicks);
    if (isFinite(e)) { spend += e; has = true; }
    if (isFinite(g)) revenue += g;
    if (isFinite(c)) clicks += c;
  }
  if (!has) return { spend: null, roas: null, cpc: null };
  return {
    spend: round2(spend),
    roas: spend > 0 && revenue > 0 ? round2(revenue / spend) : null,
    cpc: clicks > 0 ? round2(spend / clicks) : null,
  };
}

/** 广告余额（response.total_balance，含付费+赠金），无则 null */
function normalizeBalance(json) {
  const resp = json && json.response && typeof json.response === 'object' ? json.response : null;
  if (!resp) return null;
  const v = resp.total_balance;
  if (typeof v === 'number' && isFinite(v)) return v;
  if (typeof v === 'string' && v !== '' && isFinite(Number(v))) return Number(v);
  return null;
}

module.exports = { normalizeAdsHourly, normalizeBalance };
