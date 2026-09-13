// 监控大屏共用的常量与纯函数（无 Vue 依赖、无副作用）：
// 告警级别配色 / 矩阵指标清单 / 指标所属采集域 / 采集失败信息 / 时间与数值格式化。
// 由 App.vue 与各子组件共同引用，避免同一份定义在多处复制。

export const LEVEL_COLOR = { P0: '#FF3B30', P1: '#FF9500', P2: '#FFD60A' };
export const LEVEL_NAME = { P0: '紧急', P1: '重要', P2: '提醒' };
export const OK_COLOR = '#30D158';
/** 已恢复 / 已关闭告警的中性色（避免模板里散落硬编码色值） */
export const RECOVERED_COLOR = '#5b6272';

// 多店对比矩阵展示的指标与顺序
export const MATRIX_METRICS = [
  'order.pending_24h', 'firstmile.unbound', 'product.out_of_stock', 'product.low_stock',
  'product.violations', 'health.late_shipment_rate', 'health.non_fulfilment_rate', 'health.rating',
  'health.punishments', 'ads.spend_today', 'ads.roas_today', 'ads.cpc_today', 'ads.balance',
  'funds.payout_15d', 'funds.pending_txn', 'funds.failed_txn', 'funds.wallet_balance',
  'aftersale.returns_24h', 'aftersale.negative_24h',
];

export const DOMAIN_LABEL = { order: '订单', product: '商品', health: '健康', ads: '广告', funds: '资金', aftersale: '售后' };
/** 矩阵分组表头的域顺序（与 MATRIX_METRICS 的分段一致） */
export const DOMAIN_ORDER = ['order', 'product', 'health', 'ads', 'funds', 'aftersale'];

// 指标 id 前缀 → 采集域（与调度任务域一致，用于定位「哪个域采集失败」）
const METRIC_DOMAIN = [
  ['order', ['order.', 'firstmile.']],
  ['product', ['product.']],
  ['health', ['health.']],
  ['ads', ['ads.']],
  ['funds', ['funds.']],
  ['aftersale', ['aftersale.']],
];

export function domainOf(metric) {
  for (const [dom, prefixes] of METRIC_DOMAIN) {
    if (prefixes.some((p) => metric.startsWith(p))) return dom;
  }
  return '';
}

/** 该店该指标所属域的最近采集失败信息（无失败返回 null） */
export function failInfo(s, metric) {
  const dom = domainOf(metric);
  const count = dom && s.failCount ? s.failCount[dom] || 0 : 0;
  if (!count) return null;
  const err = s.lastError && s.lastError[dom];
  return { dom, count, message: err && err.message ? err.message : '' };
}

/** 矩阵单元格悬浮提示（仅采集失败时非空） */
export function cellTitle(s, m) {
  const fi = failInfo(s, m.metric);
  if (!fi) return '';
  const val = m.v === null ? '无数据' : `值 ${m.v}（上次成功采集的旧值）`;
  return `${val} · ${DOMAIN_LABEL[fi.dom]}域最近采集失败 ${fi.count} 次${fi.message ? '：' + fi.message : ''}`;
}

/** 告警级别权重（P0 > P1 > P2 > 无），用于排序 */
export const levelRank = (lv) => (lv === 'P0' ? 3 : lv === 'P1' ? 2 : lv === 'P2' ? 1 : 0);

/** 店铺显示名：无名称时用店铺 ID 后四位占位 */
export function shopName(s) {
  if (!s) return '';
  return s.name || '店铺…' + String(s.shopId).slice(-4);
}

/** 时钟 HH:MM:SS */
export function fmtClock(ms) {
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** 时间戳 → 今天只显示 HH:MM，否则 MM-DD HH:MM（空值显示 —） */
export function fmtTime(ms) {
  if (!ms) return '—';
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  const today = new Date().toDateString() === d.toDateString();
  return (today ? '' : `${p(d.getMonth() + 1)}-${p(d.getDate())} `) + `${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** 持续时长（毫秒 → 「12m」「3h20m」「2d4h」），用于告警「已持续」展示 */
export function fmtDuration(ms) {
  if (!ms || ms < 0) return '';
  const min = Math.floor(ms / 60000);
  if (min < 60) return `${Math.max(1, min)}m`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h${min % 60 ? (min % 60) + 'm' : ''}`;
  const d = Math.floor(h / 24);
  return `${d}d${h % 24 ? (h % 24) + 'h' : ''}`;
}
