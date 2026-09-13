'use strict';
/**
 * Shopee 卖家中心共享层常量：会话文件路径、卖家中心主机、请求头 UA 与市场兜底。
 * 供 lib/shopee/ 下各单一职责子模块与门面 lib/shopee-session.js 复用。
 */
const path = require('path');

const SESSION_FILE = path.join(__dirname, '..', '..', 'data', 'bidding-session.json');
/** 店铺名数据源（与 /api/openapi/stores 同源，取代已删除的手工清单 config/stores.json） */
const OPENAPI_SESSION_FILE = path.join(__dirname, '..', '..', 'data', 'openapi-session.json');
const MONITOR_META_FILE = path.join(__dirname, '..', '..', 'data', 'monitor', 'meta.json');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const HOST = 'https://seller.shopee.cn';
/** 店铺市场取不到时的兜底（与各接口原有口径一致：竞价系接口按 ph 拼 cbsc_shop_region） */
const DEFAULT_REGION = 'ph';

module.exports = {
  SESSION_FILE,
  OPENAPI_SESSION_FILE,
  MONITOR_META_FILE,
  UA,
  HOST,
  DEFAULT_REGION,
};
