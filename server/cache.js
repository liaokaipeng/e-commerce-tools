'use strict';
/**
 * 缓存清理（扩展 popup「清空缓存」面板调用）：
 *   GET  /api/cache          列出可清理的缓存类别与当前状态（供 popup 展示）
 *   POST /api/cache/clear    { category } 按类别清空
 *
 * 类别与影响面（配置类文件一律不动：settings.json /
 * hotlisting-spu.json / monitor 的 rules.json 与 config.json）：
 *   video    视频上传凭证        data/video-session.json（cn 多店铺 + ph）+ 内存副本
 *   bidding  竞价登录 Cookie     data/bidding-session.json（竞价导出/取消竞价/取消 Hot Listing 共用）
 *   openapi  开放平台店铺 Token  data/openapi-session.json 的 shops（App 配置保留，清后各店铺需重新授权）
 *   monitor  监控大屏数据        alerts / meta / snapshots / 汇率缓存（阈值规则与店铺配置保留）
 *
 * 扩展自身缓存的凭证（chrome.storage.local）不经过本服务，由 popup 直接本地清理。
 */
const fs = require('fs');
const { sendJson, jsonAction } = require('./lib/http-utils');
const { SESSION_FILE, readSession } = require('./lib/shopee-session');
const creds = require('./video/creds');
const openapiStore = require('./openapi/store');
const engine = require('./monitor/engine');
const store = require('./monitor/store');
const currency = require('./monitor/currency');

// ============ 类别定义（清空动作 + 状态描述） ============
const CATEGORIES = {
  video: {
    name: '视频上传凭证',
    desc: '扩展推送的服务端凭证（跨境多店铺 + 本土）。清后视频页会自动同步清空，需重新抓取。',
    clear() {
      creds.clearCreds();
      return '已清空视频上传凭证（跨境 + 本土）';
    },
    info() {
      const s = creds.storedCreds || {};
      const cnShops = (s.cn && s.cn.shops) || {};
      const cnWith = Object.values(cnShops).filter((v) => v && (v.auth || v.cookie)).length;
      const ph = s.ph && (s.ph.auth || s.ph.cookie);
      return `跨境 ${cnWith} 个店铺有凭证 · 本土${ph ? '有' : '无'}凭证`;
    },
  },
  bidding: {
    name: '竞价登录 Cookie',
    desc: '竞价导出 / 取消竞价 / 取消 Hot Listing 共用。清后需在扩展重新「发送登录信息」。',
    clear() {
      try { fs.rmSync(SESSION_FILE, { force: true }); } catch (e) {
        throw new Error('删除竞价会话文件失败：' + e.message);
      }
      return '已清空竞价登录 Cookie';
    },
    info() {
      const s = readSession();
      if (!s || !s.cookies || !s.cookies.length) return '未保存';
      const at = s.savedAt ? `，${String(s.savedAt).slice(0, 19).replace('T', ' ')} 推送` : '';
      return `${s.cookies.length} 个 Cookie${at}`;
    },
  },
  openapi: {
    name: '开放平台店铺 Token',
    desc: '清空各店铺授权 Token（App 配置保留）。清后所有店铺需重新 OAuth 授权，监控大屏随之停摆。',
    clear() {
      openapiStore.clearShops();
      return '已清空开放平台店铺 Token（App 配置保留）';
    },
    info() {
      const st = openapiStore.status();
      if (!st.configured) return '未配置 App';
      const invalid = st.shops.filter((x) => x.invalid).length;
      return `App 已配置 · ${st.shops.length} 个店铺授权${invalid ? `（${invalid} 个待重授权）` : ''}`;
    },
  },
  monitor: {
    name: '监控大屏数据',
    desc: '清空告警记录、巡检快照与汇率缓存；阈值规则与店铺配置保留。清后大屏从零重新采集。',
    clear() {
      engine.clearAllAlerts();
      store.clearData();
      currency.clearRateCache();
      return '已清空监控数据（告警 / 快照 / 汇率缓存）';
    },
    info() {
      const alerts = engine.getAlerts({}).length;
      const rates = currency.ratesInfo();
      return `未关闭告警 ${alerts} 条 · 汇率缓存${rates.cached ? '有' : '无'}`;
    },
  },
};

function register({ get, post }) {
  get('/api/cache', (req, res) => {
    const categories = Object.entries(CATEGORIES).map(([id, c]) => ({
      id,
      name: c.name,
      desc: c.desc,
      info: safeInfo(c),
    }));
    sendJson(res, 200, { ok: true, categories });
  });

  post('/api/cache/clear', jsonAction('/api/cache/clear', async (body, req, res) => {
    const id = String((body && body.category) || '');
    const c = CATEGORIES[id];
    if (!c) {
      sendJson(res, 400, { ok: false, message: '未知缓存类别：' + (id || '(空)') });
      return;
    }
    const message = c.clear();
    console.log(`[缓存清理] ${c.name}：${message}`);
    sendJson(res, 200, { ok: true, category: id, message, info: safeInfo(c) });
  }));
}

/** 状态描述兜底：info 里任何异常都不影响清理主流程 */
function safeInfo(c) {
  try { return c.info() || ''; } catch (e) { return '状态读取失败：' + e.message; }
}

module.exports = { register };
