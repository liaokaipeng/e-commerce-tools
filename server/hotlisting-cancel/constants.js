'use strict';
// 取消注册 Hot Listing 常量。
const path = require('path');

// 各店铺 SPU ID 配置（shopId -> SPU 文本，每行一个），持久化保存（server/data 永不入库）
const SPU_CONFIG_FILE = path.join(__dirname, '..', 'data', 'hotlisting-spu.json');
const RSKU_STATUS_ENROLLED = 2;   // search_filter.rsku_status=2 即「已注册」
const PAGE_LIMIT = 20;            // 单页条数（抓包实测 8 可用；适度放大减少请求次数）
const MAX_PAGES = 200;            // 翻页上限（防死循环）
// 逐条取消注册之间的间隔，避免请求过快触发风控
const CANCEL_DELAY_MS = 300;

module.exports = {
  SPU_CONFIG_FILE,
  RSKU_STATUS_ENROLLED,
  PAGE_LIMIT,
  MAX_PAGES,
  CANCEL_DELAY_MS,
};
