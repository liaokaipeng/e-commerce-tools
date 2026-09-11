/**
 * 服务级端口常量（CommonJS，单一来源）
 *
 * 这里区分两个含义不同的端口，避免此前 main.js 与 openapi.js 各写一份「8765」造成误解：
 * - CALLBACK_PORT：开放平台 OAuth 回调期望的端口，固定 8765。
 *   浏览器扩展推送（extension/）、前端页面与 Shopee 后台登记的 redirect 地址都已按此端口硬编码，
 *   不能随监听端口变化，否则卖家授权后无法自动跳回本工具换取 token。
 * - LISTEN_PORT：HTTP 服务实际监听端口，默认等于 CALLBACK_PORT，可用环境变量 PORT 覆盖
 *   （仅供测试/临时调试，如测试用 8865）。两者不一致时 main.js 启动即打印警告。
 */
const CALLBACK_PORT = 8765;
const LISTEN_PORT = process.env.PORT || CALLBACK_PORT;

module.exports = { CALLBACK_PORT, LISTEN_PORT };
