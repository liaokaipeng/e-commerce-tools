'use strict';
/**
 * 登录状态（会话 / Cookie 匹配）
 *
 * 竞价导出（bidding）/ 取消竞价（bidding-cancel）/ 取消注册 Hot Listing（hotlisting-cancel）
 * 三个模块共用同一份登录 Cookie（server/data/bidding-session.json，由浏览器扩展推送保存）。
 * 本模块只负责会话读取、按目标域匹配 Cookie、组装请求头与登录态断言。
 */
const fs = require('fs');
const { readJson } = require('../json-file');
const { SESSION_FILE } = require('./constants');

/** 读取会话文件（不存在 / 损坏返回 null） */
function readSession() {
  if (!fs.existsSync(SESSION_FILE)) return null;
  return readJson(SESSION_FILE, null, (e) => console.warn('读取会话文件失败:', e.message));
}

/** 按目标域过滤会话里的 Cookie（无会话 / 无匹配均抛友好错误） */
function matchCookies(targetDomain) {
  const session = readSession();
  if (!session || !session.cookies || session.cookies.length === 0) {
    throw new Error('未找到登录 Cookie，请先在浏览器点扩展「发送登录信息到工具」');
  }
  const matched = session.cookies.filter(c => {
    const d = String(c.domain || '').toLowerCase();
    if (!d) return false;
    const base = d.startsWith('.') ? d.slice(1) : d;
    return targetDomain === base || targetDomain.endsWith('.' + base);
  });
  if (matched.length === 0) {
    throw new Error('没有匹配 seller.shopee.cn 的 Cookie，请重新点扩展推送');
  }
  return matched;
}

/** 组装 Cookie 请求头字符串（bidding / bidding-cancel 用） */
function loadCookieHeader(targetDomain = 'seller.shopee.cn') {
  return matchCookies(targetDomain).map(c => `${c.name}=${c.value}`).join('; ');
}

/** 组装 Cookie 并附带 SPC_CDS 值：{ header, spcCds }（hotlisting-cancel 用） */
function loadCookie(targetDomain = 'seller.shopee.cn') {
  const matched = matchCookies(targetDomain);
  const header = matched.map(c => `${c.name}=${c.value}`).join('; ');
  const spcCds = (matched.find(c => c.name === 'SPC_CDS') || {}).value || '';
  return { header, spcCds };
}

/** 登录态断言：403 或响应体含 token not found，统一抛出重新登录提示 */
function assertLoginOk(resp) {
  if (resp.status === 403 || (resp.text && resp.text.includes('token not found'))) {
    throw new Error('登录已失效（403 token not found），请重新登录卖家中心并点扩展推送');
  }
}

module.exports = {
  readSession,
  matchCookies,
  loadCookieHeader,
  loadCookie,
  assertLoginOk,
};
