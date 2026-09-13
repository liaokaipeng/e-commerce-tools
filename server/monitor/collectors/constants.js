'use strict';
// 采集域常量与数据字典：翻页/时间窗/阈值等配置，及接口返回值到中文文案的枚举映射。
// 各域接口形态见对应采集器（order/product/health/ads/funds/aftersale）头注释。
const PAGE_SIZE = 100;
const MAX_PAGES = 10; // 单接口翻页上限
const ORDER_WINDOW_DAYS = 14; // 订单查询时间窗（官方要求 ≤15 天）
const ITEM_SCAN_WINDOW_DAYS = 30; // 商品列表更新时间窗
const ITEMS_PER_SCAN = 50; // 每轮抽查库存的商品数（控制 67 店的调用量，按更新时间倒序抽查）
const LOW_STOCK_LINE = 5; // 低库存判定线（件）
const FUNDS_WINDOW_DAYS = 15; // 资金域查询时间窗（打款明细/钱包流水官方 ≤15 天）
const AFTERSALE_WINDOW_MS = 24 * 3600 * 1000; // 售后评价域统计窗口（近 24h）
const COMMENT_SCAN_ITEMS = 20; // 差评扫描降级模式：逐商品抽查的商品数上限
const NEGATIVE_STAR_MAX = 3; // 差评判定：1~3 星
// 差评关键词（告警明细用；命中仅作展示，不影响差评计数口径）
const COMMENT_KEYWORDS = ['假货', '假的', '质量差', '很烂', '垃圾', '不满意', '太慢', '破损', '坏了'];
// 告警结构化明细行（rows：[{ id, title, sub }]）单值截断长度（行数上限由引擎统一截断）
const SNIPPET_MAX = 60;

// 处罚级别枚举（get_punishment_history 的 punishment_list[].reason，1~5 即 Tier1~Tier5）
const PUNISHMENT_TIER_NAMES = { 1: 'Tier1', 2: 'Tier2', 3: 'Tier3', 4: 'Tier4', 5: 'Tier5' };

// 问题商品原因枚举（get_listings_with_issues 的 listing_list[].reason，官方值 1~7）
const VIOLATION_REASON_NAMES = {
  1: '违禁商品', 2: '假冒商品', 3: '滥用', 4: '图片不当', 5: '信息不足', 6: '商城商品优化', 7: '其他商品优化',
};

// 退货原因枚举中文映射（get_return_list 的 return[].reason，官方 31 个值）
const RETURN_REASON_NAMES = {
  NONRECEIPT: '未收到货', WRONG_ITEM: '发错商品', ITEM_DAMAGED: '商品损坏', DIFF_DESC: '与描述不符',
  MUITAL_AGREE: '协商一致', OTHER: '其他', USED: '已使用', NO_REASON: '无理由', ITEM_WRONGDAMAGED: '错发/损坏',
  CHANGE_MIND: '改变主意', ITEM_MISSING: '少件', EXPECTATION_FAILED: '未达预期', ITEM_FAKE: '疑似假货',
  PHYSICAL_DMG: '外观损坏', FUNCTIONAL_DMG: '功能故障', ITEM_NOT_FIT: '不合适', SUSPICIOUS_PARCEL: '包裹可疑',
  EXPIRED_PRODUCT: '商品过期', WRONG_ORDER_INFO: '订单信息错误', WRONG_ADDRESS: '地址错误',
  CHANGE_OF_MIND: '改变主意', SELLER_SENT_WRONG_ITEM: '卖家发错', SPILLED_CONTENTS: '内容物洒漏',
  BROKEN_PRODUCTS: '商品破损', DAMAGED_PACKAGE: '包装破损', SCRATCHED: '划痕', DAMAGED_OTHERS: '其他损坏',
  SIZE_DEVIATION: '尺寸偏差', LOOK_DEVIATION: '外观偏差', DATE_DEVIATION: '日期偏差', DIFFERENT_DESCRIPTION: '与描述不符',
};

module.exports = {
  PAGE_SIZE,
  MAX_PAGES,
  ORDER_WINDOW_DAYS,
  ITEM_SCAN_WINDOW_DAYS,
  ITEMS_PER_SCAN,
  LOW_STOCK_LINE,
  FUNDS_WINDOW_DAYS,
  AFTERSALE_WINDOW_MS,
  COMMENT_SCAN_ITEMS,
  NEGATIVE_STAR_MAX,
  COMMENT_KEYWORDS,
  SNIPPET_MAX,
  PUNISHMENT_TIER_NAMES,
  VIOLATION_REASON_NAMES,
  RETURN_REASON_NAMES,
};
