'use strict';
// 开放平台常量：环境 host / 接口路径 / 默认回调地址 / token 余量。
// 官方资料：docs/shopee_api_doc/（授权与鉴权：open.shopee.com/developer-guide/20）

// 环境 -> 官方 API 网关 host（生产 / 沙箱）
const ENV_HOSTS = {
  prod: 'https://partner.shopeemobile.com',
  sandbox: 'https://partner.test-stable.shopeemobile.com',
};

// 环境下拉选项（前端展示顺序）
const ENVS = ['prod', 'sandbox'];

// 官方接口路径（v2）
const API_PATH = {
  authPartner: '/api/v2/shop/auth_partner',        // 生成卖家授权链接
  tokenGet: '/api/v2/auth/token/get',              // 授权码换 access/refresh token
  accessTokenGet: '/api/v2/auth/access_token/get', // 刷新 token（旧 refresh 立即失效）
  getShopInfo: '/api/v2/shop/get_shop_info',       // 测试用：返回店铺名
};

// 默认授权回调地址。官方后台对 redirect 只做「域名」校验：不接受 IP/localhost 及指向本机的
// 通配域名，且要求不能带 ? 查询参数。默认用 example.com 占位——后台与本工具两边填成一致即可，
// 授权后浏览器跳到该地址，把地址栏完整链接粘贴回本工具「手动完成授权」（或按页面说明放转发页自动跳回）。
const DEFAULT_REDIRECT = 'https://example.com/';

// 本机可达域名白名单（均解析到 127.0.0.1，可走自动回调流程）：
// - 127.0.0.1 / localhost：本机直连（若后台接受）
// - 127.0.0.1.sslip.io / 127.0.0.1.nip.io：IP 前缀通配 DNS，解析回 127.0.0.1
// - localtest.me / lvh.me：直接解析到 127.0.0.1
const LOCAL_REDIRECT_HOSTS = [
  '127.0.0.1',
  'localhost',
  '127.0.0.1.sslip.io',
  '127.0.0.1.nip.io',
  'localtest.me',
  'lvh.me',
];

// access_token 到期判断余量（秒）：提前视为过期，避免临界调用失败
const ACCESS_EXPIRE_MARGIN = 60;

// 店铺列表「即将过期」阈值（秒）
const EXPIRING_SOON_SEC = 30 * 60;

module.exports = {
  ENV_HOSTS,
  ENVS,
  API_PATH,
  DEFAULT_REDIRECT,
  LOCAL_REDIRECT_HOSTS,
  ACCESS_EXPIRE_MARGIN,
  EXPIRING_SOON_SEC,
};
