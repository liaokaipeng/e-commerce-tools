'use strict';
// 告警引擎：快照指标入库 → 规则评估 → 告警生命周期（去重/升级/回稳移出/关闭）→ SSE 广播。
// 告警只在大屏展示（本期不接 IM），页面经 /api/monitor/events 实时接收，迟到连接自动回放。
const {
  ALERT_CAP, EVENT_LOG_CAP, LEVEL_ORDER, METRICS, isMoneyMetric,
} = require('./constants');
const { evaluateRule, isMoreSevere } = require('./rules');
const { toRmb, moneyText } = require('./currency');
const store = require('./store');

// ---------- 内存态 ----------
// 兼容旧落盘数据：历史上的「已恢复」状态记录直接丢弃（该状态已整体移除）
let alerts = store.loadAlerts().filter((a) => a.status !== 'recovered'); // [{ id, seq, shopId, ruleId, domain, metric, title, unit, level, status, current, count, firstAt, lastAt, updatedAt, suggest, message }]
let alertsDirty = false;

// SSE：连接集合 + 事件回放缓存
const clients = new Set();
const eventLog = [];

function broadcast(type, data) {
  const ev = { type, data, at: Date.now() };
  eventLog.push(ev);
  if (eventLog.length > EVENT_LOG_CAP) eventLog.splice(0, eventLog.length - EVENT_LOG_CAP);
  const line = `data: ${JSON.stringify(ev)}\n\n`;
  for (const res of clients) {
    try { res.write(line); } catch { /* 连接已断 */ }
  }
}

function addClient(res) {
  clients.add(res);
}

function removeClient(res) {
  clients.delete(res);
}

function replayTo(res) {
  for (const ev of eventLog) {
    try { res.write(`data: ${JSON.stringify(ev)}\n\n`); } catch { /* 忽略 */ }
  }
}

// ---------- 告警生命周期 ----------
// 时间触发升级窗口：P2 持续 24h 升 P1；P1 每 2h 重闪（大屏重新置顶提醒）
const ESCALATE_P2_MS = 24 * 3600 * 1000;
const REFLASH_P1_MS = 2 * 3600 * 1000;
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

/** 按 (shopId, ruleId) 找告警记录 */
function findAlert(shopId, ruleId) {
  return alerts.find((a) => a.shopId === shopId && a.ruleId === ruleId);
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
 * 指标快照入库：逐指标评估规则，触发/升级/去重计数。
 * @param {string} shopId
 * @param {string} domain 采集域（order/product/health/ads/funds/aftersale）
 * @param {object} metrics { metricId: number }
 * @param {number} at 采样时间（ms）
 * @param {object} [details] { metricId: 明细 }，值为纯文本（拼入消息，兼容旧调用）
 *                           或 { text, rows } 对象（text 拼入消息；rows 为结构化明细行 [{id,title,sub}]，存入告警供大屏详情抽屉展示）
 */
function ingest(shopId, domain, metrics, at, details) {
  const now = at || Date.now();
  const rulesById = store.getRulesById();
  const changed = [];
  for (const [metric, v] of Object.entries(metrics || {})) {
    const rule = rulesById[metric];
    if (!rule || rule.enabled === false) continue;
    const level = evaluateRule(rule, compareValue(metric, v, shopId));
    const existing = findAlert(shopId, rule.id);
    if (!level) {
      if (existing) existing.current = v; // 未触发但告警开着：更新当前值，供回稳清理判断
      continue;
    }
    if (!existing) {
      const a = {
        id: shopId + ':' + rule.id,
        seq: 1,
        shopId,
        ruleId: rule.id,
        domain: rule.domain,
        metric: rule.metric,
        title: rule.title,
        unit: (METRICS[rule.metric] || {}).unit || '',
        level,
        status: 'open',
        current: v,
        count: 1,
        firstAt: now,
        lastAt: now,
        updatedAt: now,
        suggest: rule.suggest,
        message: '',
      };
      applyDetail(a, details);
      alerts.push(a);
      changed.push(Object.assign({}, a, { change: 'new' }));
      continue;
    }
    if (existing.status === 'closed') {
      // 人工关闭后再次触发：重新打开（seq+1 便于前端识别新记录）
      existing.seq = (existing.seq || 1) + 1;
      existing.status = 'open';
      existing.count = 1;
      existing.current = v;
      existing.level = level;
      existing.firstAt = now;
      existing.lastAt = now;
      existing.updatedAt = now;
      applyDetail(existing, details);
      changed.push(Object.assign({}, existing, { change: 'reopen' }));
      continue;
    }
    existing.current = v;
    existing.lastAt = now;
    existing.count = (existing.count || 0) + 1;
    const escalated = isMoreSevere(level, existing.level);
    if (escalated) existing.level = level;
    applyDetail(existing, details);
    existing.updatedAt = now;
    changed.push(Object.assign({}, existing, { change: escalated ? 'escalate' : 'update' }));
  }
  // 例行维护：回稳清理 + 时间触发升级
  maintain(now);
  alertsDirty = true;
  for (const a of changed) broadcast('alert', a);
  prune();
  return changed;
}

/**
 * 例行维护：
 * - 回稳清理：开着的告警当前值已回到阈值内 → 直接从告警流移除
 * - 时间升级：open P2 持续 24h → P1；open P1 每 2h 重闪
 */
function maintain(now) {
  const t = now || Date.now();
  const rulesById = store.getRulesById();
  // 倒序遍历：回稳的告警直接从数组移除（已移除「已恢复」状态），倒序可安全 splice
  for (let i = alerts.length - 1; i >= 0; i--) {
    const a = alerts[i];
    if (a.status !== 'open' && a.status !== 'ack') continue;
    const rule = rulesById[a.ruleId];
    if (!rule) continue;
    if (a.domain !== 'system') {
      const level = evaluateRule(rule, compareValue(a.metric, a.current, a.shopId));
      if (!level) {
        alerts.splice(i, 1);
        broadcast('alert', Object.assign({}, a, { change: 'delete' }));
        continue;
      }
    }
    if (a.status === 'open' && a.level === 'P2' && t - a.firstAt >= ESCALATE_P2_MS) {
      a.level = 'P1';
      a.updatedAt = t;
      broadcast('alert', Object.assign({}, a, { change: 'escalate' }));
    } else if (a.status === 'open' && a.level === 'P1' && t - a.updatedAt >= REFLASH_P1_MS) {
      a.updatedAt = t; // 重新置顶闪烁提醒
      broadcast('alert', Object.assign({}, a, { change: 'reflash' }));
    }
  }
  alertsDirty = true;
}

/**
 * 采集失败记录（系统自检告警）：
 * 连续失败 1 次 P2 / 2 次 P1 / ≥5 次 P0（P0 留给「长时间失联」，
 * 避免店铺统一失效时第一波 3 个域同时失败就把全场刷成红色）；
 * 成功采集后调用 systemOk 移除告警。
 */
function systemFail(shopId, domain, message, at) {
  const now = at || Date.now();
  const rule = store.getRulesById()['system.collect_fail'];
  const existing = findAlert(shopId, 'system.collect_fail');
  // 规则被用户关闭：不再产生系统自检告警；已开着的直接从告警流移除（否则会永远挂在那里，
  // 因为 maintain 的回稳检测只对业务域生效，system 域没有别的清理信号）。
  if (!rule || rule.enabled === false) {
    if (existing && (existing.status === 'open' || existing.status === 'ack')) {
      const i = alerts.indexOf(existing);
      if (i >= 0) alerts.splice(i, 1);
      broadcast('alert', Object.assign({}, existing, { change: 'delete' }));
    }
    alertsDirty = true;
    return null;
  }
  const count = (existing && existing.status !== 'closed' ? existing.count : 0) + 1;
  const level = count >= 5 ? 'P0' : count >= 2 ? 'P1' : 'P2';
  const text = `店铺最近一次采集失败（${domain}）：${message || '未知错误'}（连续 ${count} 次）`;
  if (!existing || existing.status === 'closed') {
    const a = {
      id: shopId + ':system.collect_fail',
      seq: existing ? (existing.seq || 1) + 1 : 1,
      shopId,
      ruleId: 'system.collect_fail',
      domain: 'system',
      metric: 'system.collect_fail',
      title: rule ? rule.title : '采集连续失败',
      unit: '次',
      level,
      status: 'open',
      current: count,
      count,
      firstAt: now,
      lastAt: now,
      updatedAt: now,
      suggest: rule ? rule.suggest : '',
      message: text,
    };
    alerts.push(a);
    broadcast('alert', Object.assign({}, a, { change: 'new' }));
  } else {
    existing.current = count;
    existing.count = count;
    existing.lastAt = now;
    existing.updatedAt = now;
    const escalated = isMoreSevere(level, existing.level);
    if (escalated) existing.level = level;
    existing.message = text;
    broadcast('alert', Object.assign({}, existing, { change: escalated ? 'escalate' : 'update' }));
  }
  alertsDirty = true;
  prune();
}

/** 采集成功：直接从告警流移除系统自检告警 */
function systemOk(shopId) {
  const a = findAlert(shopId, 'system.collect_fail');
  if (a && (a.status === 'open' || a.status === 'ack')) {
    const i = alerts.indexOf(a);
    if (i >= 0) alerts.splice(i, 1);
    broadcast('alert', Object.assign({}, a, { change: 'delete' }));
    alertsDirty = true;
  }
}

/** 人工确认告警 */
function ackAlert(id) {
  const a = alerts.find((x) => x.id === id);
  if (!a) return null;
  a.status = 'ack';
  a.updatedAt = Date.now();
  alertsDirty = true;
  broadcast('alert', Object.assign({}, a, { change: 'ack' }));
  return Object.assign({}, a);
}

/** 人工关闭告警（终端态；再次触发会重新打开）。已关闭时幂等返回，不重复广播。 */
function closeAlert(id) {
  const a = alerts.find((x) => x.id === id);
  if (!a) return null;
  if (a.status === 'closed') return Object.assign({}, a);
  a.status = 'closed';
  a.updatedAt = Date.now();
  alertsDirty = true;
  broadcast('alert', Object.assign({}, a, { change: 'close' }));
  return Object.assign({}, a);
}

/**
 * 人工删除告警：从内存与落盘移除（区别于 closeAlert 的「终端态保留」）。
 * 大屏上以「删除」为唯一人工操作；删除后下一轮采集若仍异常会重新触发（计数重新起算）。
 * 已不存在时返回 null（幂等）。
 */
function deleteAlert(id) {
  const i = alerts.findIndex((x) => x.id === id);
  if (i < 0) return null;
  const [a] = alerts.splice(i, 1);
  alertsDirty = true;
  broadcast('alert', Object.assign({}, a, { change: 'delete' }));
  // 返回值同样带 change:'delete'（与 SSE 事件形态一致）：路由把它随响应发回发起页面，
  // 前端 upsertAlert 据此移除；不带的话响应回填会把刚删除的告警塞回列表（「闪回」bug）
  return Object.assign({}, a, { change: 'delete' });
}

/** 清空全部告警（内存 + 落盘 + 广播 reset），供缓存清理调用；注意原地清空（_test 持有同一数组引用） */
function clearAllAlerts() {
  alerts.splice(0, alerts.length);
  alertsDirty = true;
  flushAlerts();
  broadcast('reset', { at: Date.now() });
}

/** 关闭某店铺全部未关闭告警（停用监控时调用，重新启用后触发会重新打开），返回关闭条数 */
function closeShopAlerts(shopId) {
  let n = 0;
  for (const a of alerts) {
    if (a.shopId !== shopId || a.status === 'closed') continue;
    a.status = 'closed';
    a.updatedAt = Date.now();
    broadcast('alert', Object.assign({}, a, { change: 'close' }));
    n += 1;
  }
  if (n) alertsDirty = true;
  return n;
}

/** 容量控制：超出上限时淘汰最旧的已关闭记录，其次最旧 P2 */
function prune() {
  if (alerts.length <= ALERT_CAP) return;
  const rank = (a) => (a.status === 'closed' ? 0 : LEVEL_ORDER[a.level] || 1);
  alerts.sort((a, b) => rank(a) - rank(b) || a.lastAt - b.lastAt);
  const removed = alerts.splice(0, alerts.length - ALERT_CAP);
  if (removed.length) console.log(`[监控] 告警超过 ${ALERT_CAP} 条，淘汰 ${removed.length} 条最旧记录`);
}

/** 查询告警（默认含 open/ack，closed 需显式指定） */
function getAlerts({ level, shopId, status, limit } = {}) {
  let list = alerts.slice();
  if (level) list = list.filter((a) => a.level === level);
  if (shopId) list = list.filter((a) => a.shopId === shopId);
  if (status) list = list.filter((a) => a.status === status);
  else list = list.filter((a) => a.status !== 'closed');
  // 排序：级别从重到轻 → 更新时间从新到旧
  list.sort((a, b) => (LEVEL_ORDER[b.level] || 0) - (LEVEL_ORDER[a.level] || 0) || b.updatedAt - a.updatedAt);
  if (limit && limit > 0) list = list.slice(0, limit);
  return list.map((a) => Object.assign({}, a));
}

/** 汇总：各店各级别未关闭告警数与最高级别，以及全局总数。可传 onlyShopIds（Set）只统计启用监控的店铺。 */
function summary(onlyShopIds) {
  const totals = { P0: 0, P1: 0, P2: 0 };
  const byShop = {};
  for (const a of alerts) {
    if (a.status === 'closed') continue;
    if (onlyShopIds && !onlyShopIds.has(a.shopId)) continue;
    totals[a.level] += 1;
    if (!byShop[a.shopId]) byShop[a.shopId] = { P0: 0, P1: 0, P2: 0, maxLevel: null };
    byShop[a.shopId][a.level] += 1;
    if (!byShop[a.shopId].maxLevel || isMoreSevere(a.level, byShop[a.shopId].maxLevel)) {
      byShop[a.shopId].maxLevel = a.level;
    }
  }
  return { totals, byShop };
}

/** 落盘（防抖：5 秒内多次变更合并写一次） */
function flushAlerts() {
  if (!alertsDirty) return;
  alertsDirty = false;
  store.saveAlerts(alerts);
}
const flushTimer = setInterval(flushAlerts, 5000);
if (flushTimer.unref) flushTimer.unref();

module.exports = {
  ingest,
  maintain,
  systemFail,
  systemOk,
  ackAlert,
  closeAlert,
  deleteAlert,
  closeShopAlerts,
  clearAllAlerts,
  getAlerts,
  summary,
  addClient,
  removeClient,
  replayTo,
  broadcast,
  flushAlerts,
  // 按当前金额单位模式重渲染告警消息（金额指标随模式切换换算；路由层读取告警时调用）：
  // 基础文案重新生成，明细文本（detailText，不随模式变化）原样保留；
  // 旧落盘记录没有 detailText 字段时保持原 message 不动（可能已含明细文本）。
  renderAlertMessage(a) {
    const base = msgOf(a);
    if (a.detailText != null) return a.detailText ? base + '；' + a.detailText : base;
    return a.message || base;
  },
  shopCurrency,
  _test: { alerts },
};
