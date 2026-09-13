'use strict';
/**
 * Shopee 多店监控大屏模块（CommonJS）
 * 由合并服务 main.js 引入，通过 register({ get, post }) 注册路由。
 * 功能：定时采集已授权店铺（订单履约/商品库存/账户健康）→ 规则引擎三级告警（P0/P1/P2）→
 *       大屏页面（frontend/src/monitor/）展示店铺健康墙/趋势图/对比矩阵/告警流。
 * 本期告警只在大屏展示（不接 IM）；数据存 server/data/monitor/（凭证不入库）。
 * 链路拆分到 monitor/ 子模块：
 *   constants.js  常量（数据目录/级别/任务/指标/默认规则）
 *   rules.js      规则评估纯函数
 *   store.js      快照/告警/规则覆盖/meta 持久化
 *   collectors.js 开放平台接口采集（callOpenApi，防御式解析）
 *   engine.js     告警生命周期（去重/升级/恢复/确认关闭）+ SSE 广播
 *   scheduler.js  巡检调度（每店串行、跨店并发限流、手动触发）
 */
const { sendJson, sse, jsonAction } = require('./lib/http-utils');
const { MATRIX_METRICS, METRICS } = require('./monitor/constants');
const { levelOf } = require('./monitor/rules');
const { toRmb, fromRmb, roundMoney, symbolOf, ensureRates } = require('./monitor/currency');
const store = require('./monitor/store');
const engine = require('./monitor/engine');
const scheduler = require('./monitor/scheduler');
const openapiStore = require('./openapi/store');

/** 指标是否为金额类（单位「元」；阈值按人民币比较、展示按全局模式换算） */
function isMoneyMetric(metricId) {
  return (METRICS[metricId] || {}).unit === '元';
}

/** 单店大屏数据：最新指标 + 矩阵定级（金额指标按全局模式换算展示、按人民币定级） */
function shopView(shopId, name) {
  const meta = store.getMeta();
  const m = (meta.shops && meta.shops[shopId]) || {};
  const latest = m.latest || {};
  const rulesById = store.getRulesById();
  const mode = store.getCurrencyMode();
  const currency = String(m.currency || 'CNY');
  const matrix = MATRIX_METRICS.map((metric) => {
    const p = latest[metric];
    const v = p && typeof p.v === 'number' ? p.v : null;
    const money = isMoneyMetric(metric);
    // 级别用人民币换算值比较（阈值口径固定人民币）；展示值按模式换算
    const { level } = levelOf(metric, money && v != null ? toRmb(v, currency) : v, rulesById);
    const display = money && v != null && mode === 'rmb' ? roundMoney(toRmb(v, currency)) : v;
    return { metric, v: display, at: p ? p.at : null, level };
  });
  return {
    shopId,
    name: name || m.name || '',
    lastRun: m.lastRun || {},
    failCount: m.failCount || {},
    consecutiveFails: m.consecutiveFails || 0,
    lastError: m.lastError || {},
    unsupported: m.unsupported || {},
    currency: currency,
    latest,
    matrix,
  };
}

// ============ 阈值分位数建议（只读快照，不落盘、不自动应用） ============
// 用途：默认阈值常与店铺实际量级不匹配（如「扣分记录数」恒为 1 却默认 p1=1 → 常驻 P1；
// 大店广告花费远超默认阈值 → 每轮必 P0）。这里按监控店铺的历史样本算分位数给「建议值」，
// 并给出「当前阈值历史命中率」，帮助判断阈值是否过于敏感；是否采纳完全由用户在规则面板决定。
const SUGGEST_DAYS_DEFAULT = 30;
const SUGGEST_MIN_SAMPLES = 20;

/** 按指标单位取整建议值（百分比/评分/倍数保留 2 位，金额与计数取整） */
function roundByUnit(v, unit) {
  if (typeof v !== 'number' || !isFinite(v)) return null;
  if (unit === '%' || unit === '分' || unit === '倍') return Math.round(v * 100) / 100;
  return Math.round(v);
}

/** 升序数组的最近秩分位数（p 取 0~1） */
function percentile(sorted, p) {
  if (!sorted.length) return null;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * p)));
  return sorted[idx];
}

/** 逐规则计算历史样本（金额类先换算成人民币，与阈值比较口径一致），返回 { suggest, hitRate, flat } */
function buildRuleSuggestions(days) {
  const sched = scheduler.status();
  const monitored = sched.shops.filter((s) => s.monitored && !s.authBroken);
  const meta = store.getMeta();
  const rulesById = store.getRulesById();
  const out = {};
  for (const rule of store.getRules()) {
    if (rule.domain === 'system' || rule.type !== 'threshold') continue;
    const metric = rule.metric;
    const m = METRICS[metric] || {};
    const dir = m.direction || 'up';
    const unit = m.unit || '';
    const money = unit === '元';
    const samples = [];
    for (const s of monitored) {
      const cur = String((meta.shops && meta.shops[s.shopId] && meta.shops[s.shopId].currency) || 'CNY');
      for (const p of store.readTrend(s.shopId, metric, days)) {
        if (typeof p.v !== 'number' || !isFinite(p.v)) continue;
        samples.push(money ? toRmb(p.v, cur) : p.v);
      }
    }
    samples.sort((a, b) => a - b);
    const n = samples.length;
    // 当前阈值历史命中率（值落进任一触发级别即算命中；100% = 阈值过于敏感）
    let hit = 0;
    for (const v of samples) if (levelOf(metric, v, rulesById).level) hit += 1;
    const hitRate = n ? Math.round((hit / n) * 1000) / 10 : null;
    let suggest = null;
    let flat = false;
    if (n >= SUGGEST_MIN_SAMPLES) {
      // up（越大越差）：P75/P90/P97；down（越小越差）：P25/P10/P03
      const raw = dir === 'up'
        ? { p2: percentile(samples, 0.75), p1: percentile(samples, 0.9), p0: percentile(samples, 0.97) }
        : { p2: percentile(samples, 0.25), p1: percentile(samples, 0.1), p0: percentile(samples, 0.03) };
      suggest = { p2: roundByUnit(raw.p2, unit), p1: roundByUnit(raw.p1, unit), p0: roundByUnit(raw.p0, unit) };
      flat = suggest.p2 === suggest.p0;
      // up 方向建议落到 0 会把「值恒为 0」变成恒触发，视为样本不足，不给建议
      if (dir === 'up' && !(suggest.p2 > 0)) suggest = null;
    }
    out[rule.id] = { metric, unit, direction: dir, samples: n, hitRate, flat, suggest };
  }
  return { days, shops: monitored.length, suggest: out };
}

// ============ 路由注册 ============
function register({ get, post }) {
  // 大屏总览：店铺列表（仅启用监控的店铺；含告警计数/最高级别/矩阵定级/授权状态）+ 全局统计
  get('/api/monitor/overview', (req, res) => {
    const openapiStatus = openapiStore.status();
    const sched = scheduler.status();
    const monitoredSet = new Set(sched.shops.filter((s) => s.monitored).map((s) => s.shopId));
    const sum = engine.summary(monitoredSet);
    const shops = sched.shops.filter((s) => s.monitored).map((s) => {
      const alerts = sum.byShop[s.shopId] || { P0: 0, P1: 0, P2: 0, maxLevel: null };
      return Object.assign(shopView(s.shopId, s.name), { alerts, authBroken: !!s.authBroken });
    });
    sendJson(res, 200, {
      ok: true,
      configured: openapiStatus.configured,
      scheduler: { running: sched.running, active: sched.active, lastTickAt: sched.lastTickAt, presenceActive: sched.presenceActive },
      totals: sum.totals,
      reAuthCount: shops.filter((s) => s.authBroken).length,
      excludedCount: sched.shops.length - shops.length,
      currencyMode: store.getCurrencyMode(),
      metrics: METRICS,
      shops,
      at: Date.now(),
    });
  });

  // 告警列表（?level=&shopId=&status=&limit=，默认不含 closed；未启用监控店铺的告警不展示）
  // 金额告警消息按当前全局金额单位模式重新渲染（切换模式后无需重启即生效）
  get('/api/monitor/alerts', (req, res, url) => {
    const q = url.searchParams;
    const excluded = store.getExcludedShopIds();
    const limit = Number(q.get('limit')) || 0;
    // limit 在「过滤未启用监控店铺」之后生效，避免排除店铺占用名额导致返回条数偏少
    let alerts = engine.getAlerts({
      level: q.get('level') || '',
      shopId: q.get('shopId') || '',
      status: q.get('status') || '',
    }).filter((a) => !excluded.has(a.shopId))
      .map((a) => Object.assign({}, a, { message: engine.renderAlertMessage(a) }));
    if (limit > 0) alerts = alerts.slice(0, limit);
    sendJson(res, 200, { ok: true, alerts });
  });

  // 告警删除：单条 { id } 或批量 { ids: [] }（大屏唯一的人工操作）。
  // 删除即从内存与落盘移除；下一轮采集若仍异常会重新触发（计数重新起算）。
  post('/api/monitor/alert-action', jsonAction('/api/monitor/alert-action', (body, req, res) => {
    const action = String(body.action || '').trim();
    if (action !== 'delete') throw new Error(action ? '无效的操作：' + action : '缺少操作 action');
    const ids = Array.isArray(body.ids)
      ? body.ids.map((x) => String(x || '').trim()).filter(Boolean)
      : [String(body.id || '').trim()].filter(Boolean);
    if (!ids.length) throw new Error('缺少告警 id');
    const alerts = [];
    for (const id of ids) {
      const a = engine.deleteAlert(id);
      if (a) alerts.push(a);
    }
    if (!alerts.length) throw new Error('告警不存在');
    sendJson(res, 200, { ok: true, alert: alerts[0], alerts, count: alerts.length });
  }));

  // 指标趋势（?shopId=&metric=&days=7&compare=1）：采样点 + 阈值（画参考线用）；金额指标按模式换算展示。
  // compare=1 时额外返回上一周期（更早 days 天）采样点，供大屏画环比对比线。
  get('/api/monitor/trend', (req, res, url) => {
    const shopId = String(url.searchParams.get('shopId') || '').trim();
    const metric = String(url.searchParams.get('metric') || '').trim();
    const days = Math.min(90, Math.max(1, Number(url.searchParams.get('days')) || 7));
    const compare = url.searchParams.get('compare') === '1';
    if (!shopId || !metric) {
      sendJson(res, 400, { ok: false, message: '缺少 shopId 或 metric' });
      return;
    }
    const m = METRICS[metric];
    const rule = store.getRulesById()[metric];
    const meta = store.getMeta();
    const shopMeta = (meta.shops && meta.shops[shopId]) || {};
    const currency = String(shopMeta.currency || 'CNY');
    const mode = store.getCurrencyMode();
    let points = store.readTrend(shopId, metric, days);
    let prevPoints = compare ? store.readTrend(shopId, metric, days, days) : [];
    let thresholds = (rule && rule.thresholds) || null;
    let unit = (m || {}).unit || '';
    if (isMoneyMetric(metric)) {
      if (mode === 'rmb') {
        const toRmbPoints = (arr) => arr.map((p) => ({ at: p.at, v: roundMoney(toRmb(p.v, currency)) }));
        points = toRmbPoints(points);
        prevPoints = toRmbPoints(prevPoints);
      } else {
        // 当地货币展示：阈值参考线同步换算成当地金额（阈值口径固定人民币）
        unit = symbolOf(currency);
        if (thresholds) {
          const th = {};
          for (const [k, v] of Object.entries(thresholds)) {
            if (typeof v === 'number') th[k] = roundMoney(fromRmb(v, currency));
          }
          thresholds = th;
        }
      }
    }
    sendJson(res, 200, {
      ok: true,
      metric: Object.assign({}, m || {}, { id: metric, unit }),
      thresholds,
      points,
      prevPoints,
    });
  });

  // 规则：GET 返回合并后的生效规则；POST 保存用户覆盖（{ overrides: { [id]: { enabled, thresholds } } }）
  get('/api/monitor/rules', (req, res) => {
    sendJson(res, 200, { ok: true, rules: store.getRules() });
  });

  post('/api/monitor/rules', jsonAction('/api/monitor/rules', (body, req, res) => {
    const rules = store.setRuleOverrides(body.overrides);
    engine.broadcast('rules', { at: Date.now() });
    sendJson(res, 200, { ok: true, rules });
  }));

  // 阈值建议（?days=30）：按监控店铺历史样本算分位数建议 + 当前阈值历史命中率。
  // 只读快照、不落盘、不自动应用；用户可在规则面板「采用」后再手动保存。
  get('/api/monitor/rule-suggestions', (req, res, url) => {
    const days = Math.min(90, Math.max(7, Number(url.searchParams.get('days')) || SUGGEST_DAYS_DEFAULT));
    sendJson(res, 200, Object.assign({ ok: true }, buildRuleSuggestions(days)));
  });

  // 监控店铺配置：GET 返回全部已授权店铺及其监控状态（含未监控的，供配置面板勾选）；
  // POST 保存排除名单 { excludedShopIds: [] }（未列出的已授权店铺默认监控）。
  get('/api/monitor/shops-config', (req, res) => {
    const openapiStatus = openapiStore.status();
    const excluded = store.getExcludedShopIds();
    const shops = scheduler.status().shops.map((s) => ({
      shopId: s.shopId,
      name: s.name || '',
      authBroken: !!s.authBroken,
      monitored: !excluded.has(s.shopId),
    }));
    sendJson(res, 200, { ok: true, configured: openapiStatus.configured, shops });
  });

  post('/api/monitor/shops-config', jsonAction('/api/monitor/shops-config', (body, req, res) => {
    if (!body || !Array.isArray(body.excludedShopIds)) throw new Error('excludedShopIds 必须是数组');
    const before = store.getExcludedShopIds();
    const after = store.setExcludedShopIds(body.excludedShopIds);
    // 新排除的店铺：关闭其未关闭告警（不再占用大屏统计）；重新勾选后采集触发会重新打开
    for (const id of after) {
      if (!before.has(id)) engine.closeShopAlerts(id);
    }
    scheduler.notifyConfigChanged();
    engine.broadcast('config', { at: Date.now() });
    sendJson(res, 200, { ok: true, excludedShopIds: [...after], message: '监控店铺配置已保存' });
  }));

  // 金额单位模式：GET 读取全局设置；POST 保存 { mode: 'local' | 'rmb' }（默认 local 当地货币）。
  // 规则面板的金额阈值始终按人民币配置与比较，模式只影响大屏金额展示（矩阵/趋势/告警消息）。
  get('/api/monitor/currency-config', (req, res) => {
    sendJson(res, 200, { ok: true, mode: store.getCurrencyMode() });
  });

  post('/api/monitor/currency-config', jsonAction('/api/monitor/currency-config', (body, req, res) => {
    const mode = store.setCurrencyMode(String(body && body.mode || ''));
    if (openapiStore.status().shops.length) ensureRates(); // 有店铺时顺带刷新汇率（异步，不阻塞响应）
    engine.broadcast('config', { at: Date.now() });
    sendJson(res, 200, { ok: true, mode, message: mode === 'rmb' ? '金额展示已切换为人民币（阈值仍按人民币比较）' : '金额展示已切换为当地货币（阈值仍按人民币比较）' });
  }));

  // 手动采集（body { shopId? }，缺省全部店铺；立即入队）
  post('/api/monitor/collect', jsonAction('/api/monitor/collect', (body, req, res) => {
    const started = scheduler.collectNow(body && body.shopId ? String(body.shopId) : '');
    sendJson(res, 200, { ok: true, started, message: `已触发 ${started.length} 项采集任务` });
  }));

  // 大屏在场心跳（按需采集）：页面打开/可见期间前端每 30s 报一次 { active: true }，
  // 离开页面报 { active: false }；服务端租约 75s 超时自动视为离开（崩溃兜底）。
  post('/api/monitor/presence', jsonAction('/api/monitor/presence', (body, req, res) => {
    const active = body && body.active === true;
    scheduler.setPresence(active);
    sendJson(res, 200, { ok: true, active, message: active ? '监控大屏在场，已开始按需巡检' : '已离开监控大屏，暂停巡检' });
  }));

  // 调度器状态（底部状态条 + 兜底轮询）
  get('/api/monitor/status', (req, res) => {
    const openapiStatus = openapiStore.status();
    sendJson(res, 200, Object.assign({ ok: true, configured: openapiStatus.configured }, scheduler.status()));
  });

  // 实时事件（SSE）：告警变更 / 采集结果 / 规则更新；迟到连接回放最近事件
  get('/api/monitor/events', (req, res) => {
    sse(res, { 'X-Accel-Buffering': 'no' });
    res.write(`data: ${JSON.stringify({ type: 'connected', at: Date.now() })}\n\n`);
    engine.replayTo(res);
    engine.addClient(res);
    req.on('close', () => engine.removeClient(res));
  });

  // 随服务启动采集调度（无 App/无店铺时空转，不发起网络请求）
  scheduler.start();
}

module.exports = { register, _test: { shopView } };
