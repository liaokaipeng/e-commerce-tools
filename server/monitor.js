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
const { sendJson, sse, readBody } = require('./lib/http-utils');
const { MATRIX_METRICS, METRICS } = require('./monitor/constants');
const { levelOf } = require('./monitor/rules');
const store = require('./monitor/store');
const engine = require('./monitor/engine');
const scheduler = require('./monitor/scheduler');
const openapiStore = require('./openapi/store');

/** 统一读 body 并兜底解析 */
async function parseBody(req) {
  try {
    return JSON.parse(await readBody(req));
  } catch (e) {
    throw new Error('请求体不是合法 JSON：' + e.message);
  }
}

/** 单店大屏数据：最新指标 + 矩阵定级 */
function shopView(shopId, name) {
  const meta = store.getMeta();
  const m = (meta.shops && meta.shops[shopId]) || {};
  const latest = m.latest || {};
  const rulesById = store.getRulesById();
  const matrix = MATRIX_METRICS.map((metric) => {
    const p = latest[metric];
    const v = p && typeof p.v === 'number' ? p.v : null;
    const { level } = levelOf(metric, v, rulesById);
    return { metric, v, at: p ? p.at : null, level };
  });
  return {
    shopId,
    name: name || m.name || '',
    lastRun: m.lastRun || {},
    failCount: m.failCount || {},
    consecutiveFails: m.consecutiveFails || 0,
    lastError: m.lastError || {},
    latest,
    matrix,
  };
}

// ============ 路由注册 ============
function register({ get, post }) {
  // 大屏总览：店铺列表（含告警计数/最高级别/矩阵定级/授权状态）+ 全局统计
  get('/api/monitor/overview', (req, res) => {
    const openapiStatus = openapiStore.status();
    const sum = engine.summary();
    const sched = scheduler.status();
    const shops = sched.shops.map((s) => {
      const alerts = sum.byShop[s.shopId] || { P0: 0, P1: 0, P2: 0, maxLevel: null };
      return Object.assign(shopView(s.shopId, s.name), { alerts, authBroken: !!s.authBroken });
    });
    sendJson(res, 200, {
      ok: true,
      configured: openapiStatus.configured,
      scheduler: { running: sched.running, active: sched.active, lastTickAt: sched.lastTickAt, presenceActive: sched.presenceActive },
      totals: sum.totals,
      reAuthCount: shops.filter((s) => s.authBroken).length,
      metrics: METRICS,
      shops,
      at: Date.now(),
    });
  });

  // 告警列表（?level=&shopId=&status=&limit=，默认不含 closed）
  get('/api/monitor/alerts', (req, res, url) => {
    const q = url.searchParams;
    sendJson(res, 200, {
      ok: true,
      alerts: engine.getAlerts({
        level: q.get('level') || '',
        shopId: q.get('shopId') || '',
        status: q.get('status') || '',
        limit: Number(q.get('limit')) || 0,
      }),
    });
  });

  // 告警操作：确认 / 关闭
  post('/api/monitor/alert-action', async (req, res) => {
    try {
      const body = await parseBody(req);
      const id = String(body.id || '').trim();
      const action = String(body.action || '').trim();
      if (!id) throw new Error('缺少告警 id');
      const a = action === 'ack' ? engine.ackAlert(id) : action === 'close' ? engine.closeAlert(id) : null;
      if (!a) throw new Error(action ? '无效的操作：' + action : '告警不存在');
      sendJson(res, 200, { ok: true, alert: a });
    } catch (e) {
      sendJson(res, 400, { ok: false, message: e.message });
    }
  });

  // 指标趋势（?shopId=&metric=&days=7）：采样点 + 阈值（画参考线用）
  get('/api/monitor/trend', (req, res, url) => {
    const shopId = String(url.searchParams.get('shopId') || '').trim();
    const metric = String(url.searchParams.get('metric') || '').trim();
    const days = Number(url.searchParams.get('days')) || 7;
    if (!shopId || !metric) {
      sendJson(res, 400, { ok: false, message: '缺少 shopId 或 metric' });
      return;
    }
    const m = METRICS[metric];
    const rule = store.getRulesById()[metric];
    sendJson(res, 200, {
      ok: true,
      metric: Object.assign({}, m || {}, { id: metric }),
      thresholds: (rule && rule.thresholds) || null,
      points: store.readTrend(shopId, metric, days),
    });
  });

  // 规则：GET 返回合并后的生效规则；POST 保存用户覆盖（{ overrides: { [id]: { enabled, thresholds } } }）
  get('/api/monitor/rules', (req, res) => {
    sendJson(res, 200, { ok: true, rules: store.getRules() });
  });

  post('/api/monitor/rules', async (req, res) => {
    try {
      const body = await parseBody(req);
      const rules = store.setRuleOverrides(body.overrides);
      engine.broadcast('rules', { at: Date.now() });
      sendJson(res, 200, { ok: true, rules });
    } catch (e) {
      sendJson(res, 400, { ok: false, message: e.message });
    }
  });

  // 手动采集（body { shopId? }，缺省全部店铺；立即入队）
  post('/api/monitor/collect', async (req, res) => {
    try {
      const body = await parseBody(req);
      const started = scheduler.collectNow(body && body.shopId ? String(body.shopId) : '');
      sendJson(res, 200, { ok: true, started, message: `已触发 ${started.length} 项采集任务` });
    } catch (e) {
      sendJson(res, 400, { ok: false, message: e.message });
    }
  });

  // 大屏在场心跳（按需采集）：页面打开/可见期间前端每 30s 报一次 { active: true }，
  // 离开页面报 { active: false }；服务端租约 75s 超时自动视为离开（崩溃兜底）。
  post('/api/monitor/presence', async (req, res) => {
    try {
      const body = await parseBody(req);
      const active = body && body.active === true;
      scheduler.setPresence(active);
      sendJson(res, 200, { ok: true, active, message: active ? '监控大屏在场，已开始按需巡检' : '已离开监控大屏，暂停巡检' });
    } catch (e) {
      sendJson(res, 400, { ok: false, message: e.message });
    }
  });

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
