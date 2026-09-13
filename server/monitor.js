'use strict';
/**
 * Shopee 多店监控大屏模块（CommonJS）
 * 由合并服务 main.js 引入，通过 register({ get, post }) 注册路由（本文件只注册路由）。
 * 功能：定时采集已授权店铺（订单/商品/健康/广告/资金/售后评价六域）→ 规则引擎三级告警（P0/P1/P2）→
 *       大屏页面（frontend/src/monitor/）展示店铺健康墙/趋势图/对比矩阵/告警流。
 * 本期告警只在大屏展示（不接 IM）；数据存 server/data/monitor/（凭证不入库）。
 * 链路拆分到 monitor/ 子模块：
 *   constants.js  常量（数据目录/级别/任务/指标/默认规则）
 *   rules.js      规则评估纯函数
 *   store.js      快照/告警/规则覆盖/meta 持久化
 *   collectors/   开放平台接口采集（按域拆分，见其 index.js）
 *   engine.js     告警生命周期（去重/升级/恢复/确认关闭）+ SSE 广播
 *   scheduler.js  巡检调度（每店串行、跨店并发限流、手动触发）
 *   view.js       单店视图投影（shopView）
 *   suggest.js    阈值分位数建议（buildRuleSuggestions）
 */
const { sendJson, sse, jsonAction } = require('./lib/http-utils');
const { METRICS, isMoneyMetric } = require('./monitor/constants');
const { toRmb, fromRmb, roundMoney, symbolOf, ensureRates } = require('./monitor/currency');
const store = require('./monitor/store');
const engine = require('./monitor/engine');
const scheduler = require('./monitor/scheduler');
const { shopView } = require('./monitor/view');
const { buildRuleSuggestions, SUGGEST_DAYS_DEFAULT } = require('./monitor/suggest');
const openapiStore = require('./openapi/store');

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
