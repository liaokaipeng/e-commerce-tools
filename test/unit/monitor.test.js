'use strict';
// 单元测试：监控纯函数层——规则引擎、采集解析（含 Roadmap 新增域）、金额换算。
const { t } = require('../helpers');
const {
  evaluateRule, isMoreSevere, mergeRules, levelOf,
} = require('../../server/monitor/rules');
const {
  listOf, orderAgeBuckets, stockOfModel, stockSummary, itemStockState, itemStockTotal,
  normalizeHealth, totalOf, orderSnDate, formatDdMmYyyy, normalizeAdsHourly, normalizeBalance,
  normalizePunishments, violationBreakdown, walletSummary, returnSummary, commentSummary,
  negativeCommentItems, isPermissionDenied,
} = require('../../server/monitor/collectors');
const currency = require('../../server/monitor/currency');

async function run() {
  // ===== 监控：规则引擎（纯函数） =====
  {
    const upRule = { id: 'r1', metric: 'order.pending_24h', type: 'threshold', thresholds: { p2: 3, p1: 8, p0: 15 } };
    t('规则评估 up：低于 p2 不触发', evaluateRule(upRule, 2) === null);
    t('规则评估 up：命中 p2', evaluateRule(upRule, 5) === 'P2');
    t('规则评估 up：边界值命中 p2', evaluateRule(upRule, 3) === 'P2');
    t('规则评估 up：命中 p1', evaluateRule(upRule, 9) === 'P1');
    t('规则评估 up：命中 p0', evaluateRule(upRule, 16) === 'P0');
    const downRule = { id: 'r2', metric: 'health.rating', type: 'threshold', thresholds: { p2: 4.5, p1: 4.2, p0: 4.0 } };
    t('规则评估 down：评分低触发 P1', evaluateRule(downRule, 4.1) === 'P1');
    t('规则评估 down：评分正常不触发', evaluateRule(downRule, 4.8) === null);
    const noP2 = { id: 'r3', metric: 'health.penalty_points', type: 'threshold', thresholds: { p1: 1, p0: 3 } };
    t('规则评估 缺 p2 阈值：低值不触发', evaluateRule(noP2, 0) === null);
    t('规则评估 缺 p2 阈值：直接命中 p1', evaluateRule(noP2, 2) === 'P1');
    t('规则评估 非法值返回 null', evaluateRule(upRule, NaN) === null && evaluateRule(upRule, '5') === null && evaluateRule(null, 5) === null);
    t('isMoreSevere 级别比较', isMoreSevere('P0', 'P1') && isMoreSevere('P1', 'P2') && !isMoreSevere('P2', 'P1') && isMoreSevere('P0', null) && !isMoreSevere(null, 'P1'));
    {
      const merged = mergeRules({ 'order.pending_24h': { thresholds: { p2: 5 }, enabled: false } });
      const r = merged.find((x) => x.id === 'order.pending_24h');
      t('mergeRules 覆盖阈值且未覆盖级别保留默认', r.thresholds.p2 === 5 && r.thresholds.p1 === 8);
      t('mergeRules 覆盖开关', r.enabled === false);
      t('mergeRules 未覆盖规则保持默认', merged.find((x) => x.id === 'order.cancel_pending').thresholds.p2 === 3);
      t('mergeRules 空覆盖返回默认全集', mergeRules(null).length === mergeRules({}).length);
      // 留空的级别（null）必须真正删除默认阈值，否则规则面板「留空 = 该级别不触发」不生效
      const rb = mergeRules({ 'order.pending_24h': { thresholds: { p2: null } } }).find((x) => x.id === 'order.pending_24h');
      t('mergeRules 阈值留空删除该级别（默认值不复活）', rb.thresholds.p2 === undefined && rb.thresholds.p1 === 8 && rb.thresholds.p0 === 15, JSON.stringify(rb.thresholds));
      t('mergeRules 阈值留空后该级别不再触发', evaluateRule(rb, 4) === null && evaluateRule(rb, 9) === 'P1', String(evaluateRule(rb, 4)) + '/' + String(evaluateRule(rb, 9)));
    }
    {
      const r = levelOf('product.violations', 5);
      t('levelOf 矩阵定级', r.level === 'P1' && r.rule != null, JSON.stringify(r));
      t('levelOf 未注册指标返回 null', levelOf('nope.x', 5).level === null);
    }
  }

  // ===== 监控：采集解析纯函数 =====
  {
    const now = Date.now();
    // 生成指定天数偏移的 order_sn（YYMMDD 前缀 + 任意后缀）
    const daySn = (offsetDays) => {
      const d = new Date(now + offsetDays * 86400000);
      const p = (n) => String(n).padStart(2, '0');
      return String(d.getFullYear()).slice(2) + p(d.getMonth() + 1) + p(d.getDate()) + 'ABCDEF';
    };
    const b = orderAgeBuckets([{ order_sn: daySn(0) }, { order_sn: daySn(-1) }, { order_sn: daySn(-2) }, { order_sn: daySn(-3) }], now);
    t('orderAgeBuckets 按单号日期分桶', b.pending_12_24h === 1 && b.pending_24h === 3, JSON.stringify(b));
    t('orderAgeBuckets 空数组全 0', orderAgeBuckets([], now).pending_24h === 0 && orderAgeBuckets(null, now).pending_12_24h === 0);
    t('orderSnDate 解析 YYMMDD 前缀', (() => {
      const d = orderSnDate('260816G8NXB128');
      return d && d.getFullYear() === 2026 && d.getMonth() === 7 && d.getDate() === 16;
    })());
    t('orderSnDate 非法单号返回 null', orderSnDate('ABC123') === null && orderSnDate('') === null && orderSnDate(null) === null);
    {
      const items = [
        { stock_info_v2: { summary_info: { total_available_stock: 0 } } },
        { stock_info_v2: { summary_info: { total_available_stock: 3 } } },
        { stock_info_v2: { summary_info: { total_available_stock: 20 } } },
        { stock: 0 },
        { stock: 2 },
        {},
      ];
      const s = stockSummary(items, 5);
      t('stockSummary 断货/低库存统计', s.out_of_stock === 2 && s.low_stock === 2, JSON.stringify(s));
      t('stockOfModel 读 summary_info', stockOfModel(items[0]) === 0 && stockOfModel(items[1]) === 3);
      t('stockOfModel 无库存字段返回 null', stockOfModel(items[5]) === null);
      // 商品粒度：全型号合计（停产变体不撑爆断货数）
      t('itemStockState 全 0 → out', itemStockState([{ stock: 0 }, { stock: 0 }]) === 'out');
      t('itemStockState 合计 ≤ 安全线 → low', itemStockState([{ stock: 0 }, { stock: 3 }], 5) === 'low');
      t('itemStockState 合计充足 → ok', itemStockState([{ stock: 0 }, { stock: 20 }], 5) === 'ok');
      t('itemStockState 无库存数据 → null', itemStockState([{}, { stock: null }]) === null && itemStockState([]) === null);
      t('itemStockTotal 型号库存合计', itemStockTotal([{ stock: 2 }, { stock_info_v2: { summary_info: { total_available_stock: 3 } } }]) === 5);
      t('itemStockTotal 无库存数据 → null', itemStockTotal([{}, null]) === null && itemStockTotal([]) === null);
    }
    {
      const h = normalizeHealth({
        response: {
          metric_list: [
            { metric_name: 'late_shipment_rate', current_period: 0.03 },
            { metric_name: 'non_fulfillment_rate', current_period: 0.37 },
            { metric_name: 'shop_rating', current_period: 4.78 },
          ],
          overall_performance: { rating: 4 },
        },
      });
      t('normalizeHealth 解析 metric_list', h.late_shipment_rate === 0.03 && h.non_fulfilment_rate === 0.37 && h.rating === 4.78, JSON.stringify(h));
      const h2 = normalizeHealth({ response: { overall_performance: { rating: '4.5' } } });
      t('normalizeHealth 缺 metric_list 回退 overall_performance', h2.rating === 4.5 && h2.late_shipment_rate === null);
      t('normalizeHealth 异常输入全 null', normalizeHealth(null).rating === null && normalizeHealth({}).late_shipment_rate === null);
    }
    t('totalOf 支持字符串数字与 response 包装', totalOf({ response: { total_count: '42' } }) === 42 && totalOf({ total: 7 }) === 7);
    t('totalOf 缺失返回 null', totalOf({}) === null && totalOf(null) === null);
    t('listOf 支持 response/顶层多字段', listOf({ response: { order_list: [1, 2] } }, ['order_list', 'list']).length === 2
      && listOf({ list: [1] }, ['order_list', 'list']).length === 1
      && listOf({ response: { model: [{ a: 1 }] } }, ['model', 'models']).length === 1);
    t('listOf 异常输入返回空数组', listOf(null, ['x']).length === 0 && listOf({}, ['x']).length === 0);
  }

  // ===== 监控：Roadmap 新增域解析纯函数（广告/资金/售后/处罚/明细/权限） =====
  {
    t('formatDdMmYyyy 月日补零', formatDdMmYyyy(new Date(2026, 7, 6)) === '06-08-2026', formatDdMmYyyy(new Date(2026, 7, 6)));
    t('formatDdMmYyyy 年月日不补零', formatDdMmYyyy(new Date(2026, 10, 12)) === '12-11-2026');
    const agg = normalizeAdsHourly([
      { expense: 10, direct_gmv: 30, clicks: 5 },
      { expense: 20, direct_gmv: 70, clicks: 15 },
      {},
      null,
    ]);
    t('normalizeAdsHourly 聚合花费/ROAS/CPC', agg.spend === 30 && agg.roas === 3.33 && agg.cpc === 1.5, JSON.stringify(agg));
    t('normalizeAdsHourly 空数据全 null', normalizeAdsHourly([]).spend === null && normalizeAdsHourly(null).roas === null && normalizeAdsHourly([{}]).cpc === null);
    t('normalizeAdsHourly 零点击不产出 CPC', normalizeAdsHourly([{ expense: 10, direct_gmv: 20, clicks: 0 }]).cpc === null);
    t('normalizeAdsHourly 零花费不产出 ROAS', normalizeAdsHourly([{ expense: 0, direct_gmv: 20, clicks: 2 }]).roas === null);
    t('normalizeBalance 读 response.total_balance', normalizeBalance({ response: { total_balance: 12.5 } }) === 12.5);
    t('normalizeBalance 字符串数字兜底', normalizeBalance({ response: { total_balance: '7.5' } }) === 7.5);
    t('normalizeBalance 缺失返回 null', normalizeBalance({}) === null && normalizeBalance(null) === null);
    {
      const p = normalizePunishments({ response: { total_count: 3, punishment_list: [{ reason: 1 }] } });
      t('normalizePunishments 优先取 total_count', p.count === 3 && p.detail === 'Tier1×1', JSON.stringify(p));
      const p2 = normalizePunishments({ response: { punishment_list: [{ reason: 2 }, { reason: 2 }, { reason: 5 }] } });
      t('normalizePunishments 无 total_count 回退列表长度与级别分布', p2.count === 3 && p2.detail === 'Tier2×2/Tier5×1', JSON.stringify(p2));
      t('normalizePunishments 空数据 count=0 明细空串', normalizePunishments({ response: {} }).count === 0 && normalizePunishments(null).detail === '');
    }
    t('violationBreakdown reason 中文映射聚合', violationBreakdown([{ item_id: 1, reason: 1 }, { item_id: 2, reason: 1 }, { item_id: 3, reason: 2 }, { item_id: 4 }]) === '违禁商品2/假冒商品1');
    t('violationBreakdown 空列表空串', violationBreakdown([]) === '' && violationBreakdown(null) === '');
    {
      const ws = walletSummary([
        { status: 'PENDING', current_balance: 100, create_time: 1 },
        { status: 'FAILED', current_balance: 90, create_time: 2 },
        { status: 'INITIAL', current_balance: 80, create_time: 3 },
        { status: 'COMPLETED', current_balance: 70, create_time: 4 },
      ]);
      t('walletSummary 状态计数与最新余额', ws.pending === 2 && ws.failed === 1 && ws.balance === 70, JSON.stringify(ws));
      t('walletSummary 空输入全 0/余额 null', walletSummary([]).pending === 0 && walletSummary(null).failed === 0 && walletSummary(null).balance === null);
      t('walletSummary 状态大小写不敏感', walletSummary([{ status: 'pending', current_balance: 5 }]).pending === 1);
    }
    {
      const now = Date.now();
      const rs = returnSummary([
        { reason: 'ITEM_DAMAGED', create_time: Math.floor((now - 3600000) / 1000) },
        { reason: 'WRONG_ITEM', create_time: Math.floor((now - 2 * 3600000) / 1000) },
        { reason: 'ITEM_DAMAGED', create_time: Math.floor((now - 3 * 3600000) / 1000) },
        { reason: 'OTHER', create_time: Math.floor((now - 2 * 86400000) / 1000) }, // 超 24h 不计
        {},
      ], now);
      t('returnSummary 24h 过滤与原因聚合', rs.count === 3 && rs.detail === '商品损坏2/发错商品1', rs.detail);
      t('returnSummary 未知原因兜底', returnSummary([{ reason: 'XXX', create_time: Math.floor(now / 1000) }], now).detail === 'XXX1');
      t('returnSummary 空输入全 0', returnSummary([], now).count === 0 && returnSummary(null, now).detail === '');
    }
    {
      const now = Date.now();
      const cs = commentSummary([
        { rating_star: 1, comment: '质量差 假货', create_time: Math.floor((now - 3600000) / 1000) },
        { rating_star: 2, comment: '太慢', create_time: Math.floor((now - 3 * 3600000) / 1000) },
        { rating_star: 5, comment: '很好', create_time: Math.floor((now - 3600000) / 1000) },
        { rating_star: 1, comment: '坏了', create_time: Math.floor((now - 2 * 86400000) / 1000) }, // 超 24h 不计
      ], null, now);
      t('commentSummary 1~3 星差评过滤', cs.count === 2, JSON.stringify(cs));
      t('commentSummary 关键词命中明细', cs.detail.includes('质量差') && cs.detail.includes('假货') && cs.detail.includes('太慢'), cs.detail);
      t('commentSummary 自定义关键词', commentSummary([{ rating_star: 1, comment: '色差', create_time: Math.floor(now / 1000) }], ['色差'], now).detail.includes('「色差」1'));
      t('commentSummary 空输入全 0', commentSummary([], null, now).count === 0);
      const negs = negativeCommentItems([
        { rating_star: 1, comment: '质量差', create_time: Math.floor((now - 3600000) / 1000), item_id: 1001 },
        { rating_star: 5, comment: '很好', create_time: Math.floor((now - 3600000) / 1000) },
        { rating_star: 2, comment: '太慢', create_time: Math.floor((now - 2 * 86400000) / 1000) }, // 超 24h
      ], now);
      t('negativeCommentItems 与 commentSummary 同口径（24h 内 1~3 星）', negs.length === 1 && negs[0].item_id === 1001);
    }
    t('isPermissionDenied 命中权限类错误', isPermissionDenied('开放平台错误 error_no_permission：you have no permission to access this api') === true
      && isPermissionDenied('not authorized for this api') === true && isPermissionDenied('无权访问该接口') === true);
    t('isPermissionDenied 普通错误不误报', isPermissionDenied('网络连接超时') === false && isPermissionDenied('') === false && isPermissionDenied(null) === false);
  }

  // ===== 监控：金额换算（人民币阈值口径 + 全局展示模式） =====
  {
    // 金额场景必须钉死汇率（否则在线汇率会让「500 泰铢 ≈ 105 元」这类断言随真实汇率漂移）
    currency._test.lockStaticRatesForTest();
    const { toRmb, fromRmb, regionCurrency, symbolOf, moneyText, roundMoney } = currency;
    t('toRmb 人民币不换算', toRmb(100, 'CNY') === 100);
    t('toRmb 泰铢按内置汇率换算', toRmb(500, 'THB') === 500 * 0.21, String(toRmb(500, 'THB')));
    t('toRmb 未知币种按 1:1 保守处理', toRmb(50, 'XXX') === 50);
    t('toRmb 非数值原样返回', toRmb(null, 'THB') === null && toRmb(undefined, 'THB') === undefined);
    t('fromRmb 与 toRmb 互逆', Math.abs(fromRmb(toRmb(123.45, 'THB'), 'THB') - 123.45) < 1e-9);
    t('regionCurrency 地区代码映射（大小写不敏感）', regionCurrency('TH') === 'THB' && regionCurrency('cn') === 'CNY' && regionCurrency('') === '' && regionCurrency(null) === '');
    t('symbolOf 币种符号与未知兜底', symbolOf('THB') === '฿' && symbolOf('CNY') === '¥' && symbolOf('XXX') === 'XXX');
    t('moneyText 当地货币展示原始值', moneyText(500, 'THB', 'local') === '500 ฿');
    t('moneyText 人民币模式换算展示', moneyText(500, 'THB', 'rmb') === '105 元', moneyText(500, 'THB', 'rmb'));
    t('moneyText 非数值显示 —', moneyText(null, 'THB', 'rmb') === '—');
    t('roundMoney 保留两位小数', roundMoney(1.234) === 1.23 && roundMoney(105) === 105);
  }
}

module.exports = { run };
