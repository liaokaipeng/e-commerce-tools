'use strict';
// 订单履约域采集：待发货订单（按 order_sn 日期估算年龄）、取消申请、首公里未交接。
// 接口形态（生产环境实测 2026-08）：
//   order.get_order_list  必填 order_status + time_range_field + time_from/to + page_size，
//                         返回 response.order_list（仅 order_sn/booking_sn，无时间字段），cursor 翻页；
//                         订单年龄按 order_sn 的 YYMMDD 前缀估算（无精确时间）
//   first_mile.get_unbind_order_list  返回 response.order_list + more/next_cursor
const { collectByCursor } = require('./paging');
const { detail, snDateText, orderAgeBuckets, orderAgeGroups } = require('./parse');
const { PAGE_SIZE, ORDER_WINDOW_DAYS } = require('./constants');

/** cursor 翻页收集订单列表（order_sn 列表） */
function collectOrdersByStatus(shopId, orderStatus) {
  const nowSec = Math.floor(Date.now() / 1000);
  return collectByCursor(shopId, '/api/v2/order/get_order_list', {
    order_status: orderStatus,
    time_range_field: orderStatus === 'IN_CANCEL' ? 'update_time' : 'create_time',
    time_from: nowSec - ORDER_WINDOW_DAYS * 86400,
    time_to: nowSec,
    page_size: PAGE_SIZE,
  }, 'order_list');
}

async function collectOrderDomain(shopId) {
  const metrics = {};
  const details = {};
  const errors = [];
  const now = Date.now();
  try {
    const orders = await collectOrdersByStatus(shopId, 'READY_TO_SHIP');
    // 分桶/计数统一走 parse（单号日期按天估算，避免本处与 parse 各写一份）
    const buckets = orderAgeBuckets(orders, now);
    const { today: todaySns, older: olderSns } = orderAgeGroups(orders, now);
    metrics['order.pending_12_24h'] = buckets.pending_12_24h;
    metrics['order.pending_24h'] = buckets.pending_24h;
    details['order.pending_12_24h'] = detail('', todaySns.map((sn) => ({
      id: sn, title: sn, sub: `${snDateText(sn) || '今日'} 创建·待发货`,
    })));
    details['order.pending_24h'] = detail('', olderSns.map((sn) => ({
      id: sn, title: sn, sub: `${snDateText(sn) || '更早'} 创建·待发货（超 24h 风险）`,
    })));
  } catch (e) {
    errors.push('待发货订单：' + e.message);
  }
  try {
    const cancels = await collectOrdersByStatus(shopId, 'IN_CANCEL');
    const sns = (cancels || []).map((o) => o && o.order_sn).filter(Boolean);
    metrics['order.cancel_pending'] = cancels.length;
    details['order.cancel_pending'] = detail('', sns.map((sn) => ({
      id: sn, title: sn, sub: '买家申请取消·待处理',
    })));
  } catch (e) {
    errors.push('取消申请：' + e.message);
  }
  try {
    const orders = await collectByCursor(shopId, '/api/v2/first_mile/get_unbind_order_list', { page_size: PAGE_SIZE }, 'order_list');
    metrics['firstmile.unbound'] = orders.length;
    details['firstmile.unbound'] = detail('', orders
      .map((o) => o && o.order_sn).filter(Boolean)
      .map((sn) => ({ id: sn, title: sn, sub: '首公里未交接·待打单发货' })));
  } catch (e) {
    errors.push('首公里：' + e.message);
  }
  if (Object.keys(metrics).length === 0) throw new Error(errors.join('；') || '订单域无可用数据');
  return { domain: 'order', metrics, details, errors };
}

module.exports = { collectOrderDomain };
