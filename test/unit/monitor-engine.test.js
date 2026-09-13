'use strict';
// 单元测试：监控告警引擎（生命周期 / 明细 / 金额阈值 / 系统自检 / 时间升级 / 汇总）
// 与快照存储、规则覆盖、店铺配置的持久化。
const fs = require('fs');
const { t } = require('../helpers');
const monitorEngine = require('../../server/monitor/engine');
const monitorStore = require('../../server/monitor/store');

async function run() {
  // ===== 监控：告警引擎生命周期 =====
  {
    const engine = monitorEngine;
    const now = Date.now();
    // 触发与去重
    engine.ingest('T1', 'order', { 'order.pending_24h': 4 }, now); // P2（阈值 p2=3）
    let list = engine.getAlerts({ shopId: 'T1' });
    t('引擎：首次触发生成 P2 告警', list.length === 1 && list[0].level === 'P2' && list[0].status === 'open' && list[0].count === 1, JSON.stringify(list));
    engine.ingest('T1', 'order', { 'order.pending_24h': 6 }, now + 60000);
    list = engine.getAlerts({ shopId: 'T1' });
    t('引擎：同级别去重计数', list.length === 1 && list[0].count === 2);
    // 升级
    engine.ingest('T1', 'order', { 'order.pending_24h': 10 }, now + 120000); // P1
    engine.ingest('T1', 'order', { 'order.pending_24h': 16 }, now + 180000); // P0
    list = engine.getAlerts({ shopId: 'T1' });
    t('引擎：阈值升级 P2→P1→P0', list.length === 1 && list[0].level === 'P0', JSON.stringify(list));
    // 回稳：指标回到阈值内直接从告警流移除（已移除「已恢复」状态）
    engine.ingest('T1', 'order', { 'order.pending_24h': 1 }, now + 240000);
    list = engine.getAlerts({ shopId: 'T1' });
    t('引擎：回到阈值内自动移除告警', list.length === 0, JSON.stringify(list));
    // 移除后再次触发 → 按新记录重建
    engine.ingest('T1', 'order', { 'order.pending_24h': 4 }, now + 300000);
    list = engine.getAlerts({ shopId: 'T1', status: 'open' });
    t('引擎：移除后再次触发重新生成', list.length === 1 && list[0].status === 'open' && list[0].count === 1);
    // 确认 / 关闭 / 关闭后再触发 seq+1
    const id = list[0].id;
    engine.ackAlert(id);
    t('引擎：确认后状态 ack', engine.getAlerts({ shopId: 'T1', status: 'ack' }).length === 1);
    engine.closeAlert(id);
    t('引擎：关闭后默认列表不可见', engine.getAlerts({ shopId: 'T1' }).filter((a) => a.id === id).length === 0);
    const seqBefore = engine.getAlerts({ shopId: 'T1', status: 'closed' })[0].seq;
    engine.ingest('T1', 'order', { 'order.pending_24h': 4 }, now + 360000);
    list = engine.getAlerts({ shopId: 'T1', status: 'open' });
    t('引擎：关闭后再次触发重新打开且 seq+1', list.length === 1 && list[0].seq === seqBefore + 1);
    // 删除：彻底移除（默认列表与 closed 历史都查不到），重复删除幂等，删除后再触发按新记录重建
    const delId = list[0].id;
    const removed = engine.deleteAlert(delId);
    t('引擎：删除返回被删告警且各处均不再包含',
      !!removed && removed.id === delId
      && engine.getAlerts({ shopId: 'T1' }).filter((a) => a.id === delId).length === 0
      && engine.getAlerts({ shopId: 'T1', status: 'closed' }).filter((a) => a.id === delId).length === 0,
      JSON.stringify(removed));
    // 返回值必须带 change:'delete'（与 SSE 事件形态一致）：HTTP 响应回发起页面后
    // 前端 upsertAlert 据此移除；不带会把已删告警塞回列表（「删除后闪回」bug）
    t('引擎：删除返回值带 change:delete（供前端响应路径移除）', !!removed && removed.change === 'delete', JSON.stringify(removed));
    t('引擎：重复删除返回 null（幂等）', engine.deleteAlert(delId) === null);
    engine.ingest('T1', 'order', { 'order.pending_24h': 4 }, now + 420000);
    const recreated = engine.getAlerts({ shopId: 'T1' }).filter((a) => a.id === delId);
    t('引擎：删除后再次触发按新记录重建（seq 重置为 1）', recreated.length === 1 && recreated[0].seq === 1 && recreated[0].status === 'open', JSON.stringify(recreated[0]));
  }

  // ===== 监控：告警消息明细（ingest 第 5 参 details） =====
  {
    const engine = monitorEngine;
    const now = Date.now();
    engine.ingest('T4', 'product', { 'product.violations': 2 }, now, { 'product.violations': '明细 违禁商品1/假冒商品1' });
    let a = engine.getAlerts({ shopId: 'T4' })[0];
    t('引擎：details 明细拼入新建告警消息', !!a && a.message.includes('明细 违禁商品1/假冒商品1'), a && a.message);
    engine.ingest('T4', 'product', { 'product.violations': 3 }, now + 60000, { 'product.violations': '明细 违禁商品2/滥用1' });
    a = engine.getAlerts({ shopId: 'T4' })[0];
    t('引擎：更新时刷新明细消息', !!a && a.count === 2 && a.message.includes('违禁商品2/滥用1'), a && a.message);
    engine.ingest('T4', 'product', { 'product.violations': 1 }, now + 120000); // 不带 details
    a = engine.getAlerts({ shopId: 'T4' })[0];
    t('引擎：无 details 时消息回退基础文案（向后兼容）', !!a && !a.message.includes('明细'), a && a.message);
    t('引擎：无 details 时 detailRows 清空（不残留旧清单）', Array.isArray(a.detailRows) && a.detailRows.length === 0);
    engine.closeAlert(a.id);
  }

  // ===== 监控：告警结构化明细（details { text, rows } → 消息 + detailRows） =====
  {
    const engine = monitorEngine;
    const now = Date.now();
    const rows = Array.from({ length: 250 }, (_, i) => ({ id: String(i), title: '商品 ' + i, sub: '断货' }));
    engine.ingest('TD', 'product', { 'product.violations': 2 }, now, {
      'product.violations': { text: '明细 违禁商品2', rows: [{ id: '111', title: '商品 111', sub: '违禁商品' }, { id: '222', title: '商品 222', sub: '假冒商品' }] },
    });
    let a = engine.getAlerts({ shopId: 'TD' })[0];
    t('引擎：对象 details 的 text 拼入消息', !!a && a.message.includes('明细 违禁商品2'), a && a.message);
    t('引擎：对象 details 的 rows 存入 detailRows', Array.isArray(a.detailRows) && a.detailRows.length === 2 && a.detailRows[0].id === '111' && a.detailRows[0].sub === '违禁商品', JSON.stringify(a && a.detailRows));
    engine.ingest('TD', 'product', { 'product.violations': 1 }, now + 60000); // 不带 details → rows 清空
    a = engine.getAlerts({ shopId: 'TD' })[0];
    t('引擎：明细随采集刷新（无 details 清空 rows）', a.detailRows.length === 0);
    engine.closeAlert(a.id);
    // 超限截断：250 行 → 200 行（DETAIL_ROWS_CAP）
    engine.ingest('TE', 'product', { 'product.violations': 250 }, now, { 'product.violations': { text: '', rows } });
    a = engine.getAlerts({ shopId: 'TE' })[0];
    t('引擎：detailRows 超限截断到 200', a.detailRows.length === 200, String(a.detailRows.length));
    engine.closeAlert(a.id);
    // 明细行字段统一为字符串（前端展示/复制直接用）
    engine.ingest('TF', 'product', { 'product.violations': 1 }, now, { 'product.violations': { text: '', rows: [{ id: 123, title: null, sub: undefined }] } });
    a = engine.getAlerts({ shopId: 'TF' })[0];
    t('引擎：detailRows 字段归一化为字符串', a.detailRows.length === 1 && a.detailRows[0].id === '123' && a.detailRows[0].title === '' && a.detailRows[0].sub === '', JSON.stringify(a.detailRows));
    engine.closeAlert(a.id);
    // 回归：/api/monitor/alerts 路由经 renderAlertMessage 重渲染消息时不得丢明细文本
    engine.ingest('TG', 'product', { 'product.violations': 2 }, now, { 'product.violations': { text: '明细 违禁商品2', rows: [] } });
    a = engine.getAlerts({ shopId: 'TG' })[0];
    const reMsg = engine.renderAlertMessage(Object.assign({}, a));
    t('引擎：列表消息重渲染保留明细文本', reMsg.includes('当前 2') && reMsg.includes('明细 违禁商品2'), reMsg);
    engine.closeAlert(a.id);
    // 回归：恢复后再次触发，计数/首次触发时间重新起算（曾跨恢复周期虚增 ×N）
    engine.ingest('TH', 'order', { 'order.pending_24h': 4 }, now + 60000);
    engine.ingest('TH', 'order', { 'order.pending_24h': 5 }, now + 120000);
    engine.ingest('TH', 'order', { 'order.pending_24h': 1 }, now + 180000); // 恢复
    engine.ingest('TH', 'order', { 'order.pending_24h': 6 }, now + 240000); // 再次触发
    a = engine.getAlerts({ shopId: 'TH' })[0];
    t('引擎：恢复后再次触发计数重新起算', a.status === 'open' && a.count === 1, JSON.stringify({ count: a.count, status: a.status }));
    engine.closeAlert(a.id);
  }

  // ===== 监控：金额阈值按人民币比较、按展示模式渲染 =====
  {
    const engine = monitorEngine;
    const now = Date.now();
    monitorStore.patchMeta((meta) => { meta.shops['T5'] = { currency: 'THB' }; });
    monitorStore.setCurrencyMode('rmb');
    // ads.spend_today 阈值 p2=100 元（人民币）：500 泰铢 ≈ 105 元 → P2；400 泰铢 ≈ 84 元 → 不触发
    engine.ingest('T5', 'ads', { 'ads.spend_today': 500 }, now);
    let a = engine.getAlerts({ shopId: 'T5' })[0];
    t('引擎：金额指标按人民币换算比较阈值（500泰铢≈105元触发P2）', !!a && a.level === 'P2' && a.current === 500, JSON.stringify(a));
    engine.ingest('T5', 'ads', { 'ads.spend_today': 400 }, now + 60000);
    t('引擎：换算后回落阈值内自动移除告警（400泰铢≈84元）', engine.getAlerts({ shopId: 'T5' }).length === 0, JSON.stringify(engine.getAlerts({ shopId: 'T5' })));
    engine.ingest('T5', 'ads', { 'ads.spend_today': 500 }, now + 120000);
    a = engine.getAlerts({ shopId: 'T5' })[0];
    t('引擎：rmb 模式告警消息换算为人民币', !!a && a.status === 'open' && a.message.includes('105 元'), a && a.message);
    monitorStore.setCurrencyMode('local');
    t('引擎：local 模式告警消息为当地货币原始值', monitorEngine.renderAlertMessage(a).includes('500 ฿'), monitorEngine.renderAlertMessage(a));
    // 未识别币种（CNY）：两种模式数值一致
    monitorStore.patchMeta((meta) => { meta.shops['T6'] = { currency: 'CNY' }; });
    monitorStore.setCurrencyMode('rmb');
    engine.ingest('T6', 'ads', { 'ads.spend_today': 80 }, now);
    t('引擎：人民币店铺按原值比较不触发', engine.getAlerts({ shopId: 'T6' }).length === 0, JSON.stringify(engine.getAlerts({ shopId: 'T6' })));
    engine.closeAlert(a.id);
    monitorStore.setCurrencyMode('rmb');
  }

  // ===== 监控：系统自检告警与时间升级 =====
  {
    const engine = monitorEngine;
    const now = Date.now();
    engine.systemFail('T2', 'order', '网络错误', now);
    let a = engine.getAlerts({ shopId: 'T2' })[0];
    t('系统告警：1 次失败 P2', !!a && a.domain === 'system' && a.level === 'P2' && a.status === 'open');
    engine.systemFail('T2', 'order', '网络错误', now + 1000);
    a = engine.getAlerts({ shopId: 'T2' })[0];
    t('系统告警：2 次失败升级 P1', a.level === 'P1' && a.current === 2, JSON.stringify(a));
    engine.systemFail('T2', 'order', '网络错误', now + 2000);
    a = engine.getAlerts({ shopId: 'T2' })[0];
    t('系统告警：3 次失败仍为 P1', a.level === 'P1');
    engine.systemFail('T2', 'order', '网络错误', now + 3000);
    engine.systemFail('T2', 'order', '网络错误', now + 4000);
    a = engine.getAlerts({ shopId: 'T2' })[0];
    t('系统告警：5 次失败升级 P0', a.level === 'P0' && a.current === 5);
    engine.systemOk('T2', now + 5000);
    a = engine.getAlerts({ shopId: 'T2' })[0];
    t('系统告警：采集成功自动移除告警', !a, JSON.stringify(a));
    // 时间升级：P2 挂 24h → P1
    engine.ingest('T3', 'order', { 'order.pending_12_24h': 6 }, now); // P2（阈值 p2=5）
    const t3 = monitorEngine._test.alerts.find((x) => x.shopId === 'T3');
    t3.firstAt = now - 25 * 3600 * 1000;
    engine.maintain(now + 60 * 1000);
    a = engine.getAlerts({ shopId: 'T3' })[0];
    t('引擎：P2 持续 24h 自动升级 P1', a.level === 'P1', JSON.stringify(a));
    // 汇总
    const s = engine.summary();
    t('引擎汇总：按店按级别计数', s.byShop['T1'].P2 === 1 && s.byShop['T3'].P1 === 1 && s.totals.P0 === 0 && s.totals.P1 === 1 && s.totals.P2 === 1, JSON.stringify(s));
    // 汇总白名单（只统计启用监控的店铺）
    const s2 = engine.summary(new Set(['T1']));
    t('引擎汇总：按监控店铺白名单过滤', !!s2.byShop['T1'] && !s2.byShop['T2'] && !s2.byShop['T3'] && s2.totals.P2 === 1, JSON.stringify(s2));
    // 停用监控：关闭该店全部未关闭告警
    const closedCount = engine.closeShopAlerts('T1');
    t('引擎：closeShopAlerts 关闭该店全部未关闭告警', closedCount === 1 && engine.getAlerts({ shopId: 'T1', status: 'open' }).length === 0 && engine.getAlerts({ shopId: 'T3', status: 'open' }).length === 1, JSON.stringify({ closedCount, t3: engine.getAlerts({ shopId: 'T3' }) }));
    // 系统自检告警同样尊重规则开关（面板关掉「采集连续失败」后不再告警，既有告警自动收尾）
    engine.systemFail('T8', 'product', '超时', now);
    t('系统告警：规则开启时正常触发', engine.getAlerts({ shopId: 'T8', status: 'open' }).length === 1);
    monitorStore.setRuleOverrides({ 'system.collect_fail': { enabled: false } });
    engine.systemFail('T8', 'product', '超时', now + 1000);
    t('系统告警：规则关闭后既有告警移除且不重开', engine.getAlerts({ shopId: 'T8' }).length === 0, JSON.stringify(engine.getAlerts({ shopId: 'T8' })));
    engine.systemFail('T9', 'order', '网络错误', now);
    t('系统告警：规则关闭时不产生新告警', engine.getAlerts({ shopId: 'T9' }).length === 0, JSON.stringify(engine.getAlerts({ shopId: 'T9' })));
    monitorStore.setRuleOverrides({});
    engine.systemFail('T9', 'order', '网络错误', now + 2000);
    t('系统告警：规则重新开启后恢复告警', engine.getAlerts({ shopId: 'T9', status: 'open' }).length === 1);
  }

  // ===== 监控：快照存储与规则覆盖持久化 =====
  {
    const now = Date.now();
    monitorStore.appendSample('S1', 'order.pending_24h', 5, now);
    monitorStore.appendSample('S1', 'order.pending_24h', 8, now + 60000);
    const pts = monitorStore.readTrend('S1', 'order.pending_24h', 7);
    t('快照：写入后可读回且按时间升序', pts.length === 2 && pts[0].v === 5 && pts[1].v === 8, JSON.stringify(pts));
    t('快照：不存在的店铺/指标返回空', monitorStore.readTrend('S1', 'nope.x', 7).length === 0);
    // offsetDays：offset=days 取「上一周期」窗口（大屏环比对比线用）
    monitorStore.appendSample('S2', 'order.pending_24h', 9, now);
    monitorStore.appendSample('S2', 'order.pending_24h', 3, now - 8 * 24 * 3600 * 1000);
    const curWin = monitorStore.readTrend('S2', 'order.pending_24h', 1, 0);
    const prevWin = monitorStore.readTrend('S2', 'order.pending_24h', 1, 1);
    t('快照：readTrend offsetDays 取上一周期窗口', curWin.length === 1 && curWin[0].v === 9 && prevWin.length === 1 && prevWin[0].v === 3, JSON.stringify({ curWin, prevWin }));
    let threw = false;
    try { monitorStore.setRuleOverrides({ 'unknown.rule': { enabled: false } }); } catch { threw = true; }
    t('规则覆盖：未知规则 id 报错', threw);
    const rules = monitorStore.setRuleOverrides({ 'order.pending_24h': { thresholds: { p2: 6 } } });
    t('规则覆盖：保存并生效', rules.find((r) => r.id === 'order.pending_24h').thresholds.p2 === 6);
    const rulesBlank = monitorStore.setRuleOverrides({ 'order.pending_24h': { thresholds: { p2: null } } });
    t('规则覆盖：留空阈值删除该级别（前端送 null 的链路）', rulesBlank.find((r) => r.id === 'order.pending_24h').thresholds.p2 === undefined, JSON.stringify(rulesBlank.find((r) => r.id === 'order.pending_24h').thresholds));
    monitorStore.setRuleOverrides({});
    t('规则覆盖：清空后还原默认', monitorStore.getRules().find((r) => r.id === 'order.pending_24h').thresholds.p2 === 3);
    // 监控店铺配置（排除名单）：默认全部监控
    t('店铺配置：默认全部监控', monitorStore.isMonitored('S1') && monitorStore.isMonitored('S9') && monitorStore.getExcludedShopIds().size === 0);
    monitorStore.setExcludedShopIds(['S9', 'S9', 123]);
    t('店铺配置：保存排除名单并去重转字符串', !monitorStore.isMonitored('S9') && !monitorStore.isMonitored('123') && monitorStore.isMonitored('S1') && monitorStore.getExcludedShopIds().size === 2);
    let badThrew = false;
    try { monitorStore.setExcludedShopIds('x'); } catch { badThrew = true; }
    t('店铺配置：非数组报错', badThrew);
    monitorStore.setExcludedShopIds([]);
    t('店铺配置：清空排除名单后恢复监控', monitorStore.isMonitored('S9') && monitorStore.getExcludedShopIds().size === 0);
    // 收尾：落盘并清理临时目录
    monitorEngine.flushAlerts();
    monitorStore.flushMeta();
    try { fs.rmSync(process.env.MONITOR_DATA_DIR, { recursive: true, force: true }); } catch { /* 忽略 */ }
  }
}

module.exports = { run };
