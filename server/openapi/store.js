'use strict';
// 开放平台凭证存储：server/data/openapi-session.json（gitignored，凭证不入库）。
// 结构：app = { partnerId, partnerKey, env }；shops 按环境分区，避免沙箱/生产 token 混用：
//   shops[env][shopId] = { shopId, merchantId, accessToken, refreshToken, accessExpireAt, updatedAt }
// 对外输出一律打码（maskToken），与仓库「凭证不入库、日志不完整打印」约定一致。
const fs = require('fs');
const path = require('path');
const { ENVS, ACCESS_EXPIRE_MARGIN, EXPIRING_SOON_SEC } = require('./constants');
const { maskToken, nowSec } = require('../lib/openapi-utils');

const SESSION_FILE = process.env.OPENAPI_SESSION_FILE || path.join(__dirname, '..', 'data', 'openapi-session.json');

let store = { app: null, shops: {} };

function loadFile() {
  try {
    if (!fs.existsSync(SESSION_FILE)) return;
    const raw = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8'));
    if (raw && typeof raw === 'object') {
      store.app = raw.app && typeof raw.app === 'object' ? raw.app : null;
      store.shops = raw.shops && typeof raw.shops === 'object' ? raw.shops : {};
    }
  } catch (e) {
    console.warn('读取开放平台凭证文件失败:', e.message);
  }
}

function saveFile() {
  try {
    fs.mkdirSync(path.dirname(SESSION_FILE), { recursive: true });
    fs.writeFileSync(SESSION_FILE, JSON.stringify(store, null, 2));
  } catch (e) {
    console.warn('保存开放平台凭证文件失败:', e.message);
  }
}

loadFile();

/** 取当前 App 配置（partnerKey 完整值仅内部使用） */
function getApp() {
  return store.app ? Object.assign({}, store.app) : null;
}

/** 保存 App 配置：字段校验通过才写入 */
function setApp({ partnerId, partnerKey, env }) {
  const id = String(partnerId || '').trim();
  const key = String(partnerKey || '').trim();
  const e = String(env || 'prod');
  if (!id) throw new Error('partner_id 不能为空');
  if (!key) throw new Error('partner_key 不能为空');
  if (!ENVS.includes(e)) throw new Error('无效的环境：' + e);
  store.app = { partnerId: id, partnerKey: key, env: e };
  if (!store.shops[e]) store.shops[e] = {};
  saveFile();
  return Object.assign({}, store.app);
}

/** 取某环境下的店铺凭证（完整值，仅 client 内部使用） */
function getShop(env, shopId) {
  const byEnv = store.shops[env] || {};
  const s = byEnv[String(shopId)];
  return s ? Object.assign({}, s) : null;
}

/** 取某环境下全部店铺凭证（完整值，仅 client 内部刷新分组用） */
function getShopsRaw(env) {
  return Object.values(store.shops[env] || {}).map((s) => Object.assign({}, s));
}

/**
 * 标记店铺凭证已失效（需重新授权）：网关确认凭证死透（access_token/refresh_token 无效或与店铺不匹配）后调用。
 * 只加标记不清 token（保留给页面打码展示与重新授权覆盖）。
 */
function markShopInvalid(env, shopId, reason) {
  return setShop(env, shopId, {
    invalid: true,
    invalidReason: String(reason || '凭证无效，请重新授权').slice(0, 300),
    invalidAt: Date.now(),
  });
}

/** 清除失效标记（重新授权成功 / 刷新成功 / 接口调用成功证明凭证可用时调用） */
function clearShopInvalid(env, shopId) {
  const s = getShop(env, shopId);
  if (!s || !s.invalid) return;
  setShop(env, shopId, { invalid: false, invalidReason: '', invalidAt: 0 });
}

/** 写入/更新店铺凭证（合并 patch，刷新后先拿到新 token 再调用，保证旧值不丢失） */
function setShop(env, shopId, patch) {
  const e = String(env);
  const id = String(shopId);
  if (!store.shops[e]) store.shops[e] = {};
  const prev = store.shops[e][id] || {};
  store.shops[e][id] = Object.assign({}, prev, patch, { shopId: id, updatedAt: Date.now() });
  saveFile();
  return Object.assign({}, store.shops[e][id]);
}

/** 删除某店铺凭证，返回是否真的删掉（幂等） */
function removeShop(env, shopId) {
  const byEnv = store.shops[env] || {};
  const id = String(shopId);
  if (!byEnv[id]) return false;
  delete byEnv[id];
  saveFile();
  return true;
}

/** 当前环境下已授权店铺的对外状态（token 打码 + 有效性判断） */
function status() {
  const app = getApp();
  const shops = [];
  if (app) {
    const byEnv = store.shops[app.env] || {};
    for (const s of Object.values(byEnv)) {
      const remain = (s.accessExpireAt || 0) - nowSec() - ACCESS_EXPIRE_MARGIN;
      shops.push({
        shopId: s.shopId,
        env: app.env,
        accessTokenMasked: maskToken(s.accessToken),
        refreshTokenMasked: maskToken(s.refreshToken),
        accessExpireAt: s.accessExpireAt || 0,
        remainSec: remain,
        invalid: !!s.invalid,
        invalidReason: s.invalidReason || '',
        state: s.invalid ? 're_auth' : remain > EXPIRING_SOON_SEC ? 'valid' : remain > 0 ? 'expiring' : 'expired',
        updatedAt: s.updatedAt || 0,
      });
    }
    shops.sort((a, b) => a.shopId.localeCompare(b.shopId, undefined, { numeric: true }));
  }
  return {
    configured: !!app,
    env: app ? app.env : '',
    partnerId: app ? app.partnerId : '',
    partnerKeyMasked: app ? maskToken(app.partnerKey) : '',
    shops,
  };
}

module.exports = {
  getApp, setApp, getShop, getShopsRaw, setShop, removeShop,
  markShopInvalid, clearShopInvalid, status,
};
