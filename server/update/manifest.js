'use strict';
/**
 * 远端清单拉取、比对与缓存：
 *   - fetchJson：带超时的 JSON 拉取；
 *   - snapshot：由清单字段组装对外快照（含 hasUpdate 判定）；
 *   - checkNow：拉取远端清单比对当前版本（网络失败不抛错，回落上次缓存）。
 */
const version = require('../lib/version');
const { readJson, writeJson } = require('../lib/json-file');

const { CACHE_FILE, CHECK_TIMEOUT_MS, loadConfig } = require('./config');

async function fetchJson(url, timeoutMs = CHECK_TIMEOUT_MS) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      signal: ctrl.signal,
      headers: { 'Cache-Control': 'no-cache', Pragma: 'no-cache' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (e) {
    if (e && e.name === 'AbortError') throw new Error('请求超时');
    throw new Error((e && e.message) || String(e));
  } finally {
    clearTimeout(timer);
  }
}

/** 由清单字段组装对外快照（含 hasUpdate 判定） */
function snapshot(src, currentVersionStr) {
  const latest = src && src.latest ? String(src.latest) : null;
  return {
    latest,
    url: (src && src.url) || '',
    sha256: (src && src.sha256) || '',
    notes: (src && src.notes) || '',
    builtAt: (src && src.builtAt) || null,
    checkedAt: (src && src.checkedAt) || null,
    // 只有明确拿到比当前更高的版本号才算「有新版」，避免清单写错导致误报
    hasUpdate: !!(latest && version.compareVersions(latest, currentVersionStr) > 0),
  };
}

/**
 * 检查更新：拉取远端清单比对当前版本。
 * 网络失败时**不抛错**，而是带着 error 字段回落上次缓存的结果，前端据此显示「检查失败（仍可继续使用）」。
 */
async function checkNow() {
  const cfg = loadConfig();
  const current = version.info();
  const cached = readJson(CACHE_FILE) || {};
  const base = {
    enabled: cfg.enabled,
    configured: cfg.configured,
    manifestUrl: cfg.manifestUrl,
    current,
    error: null,
    ...snapshot(cached, current.version),
  };
  if (!cfg.enabled || !cfg.configured) return base;

  try {
    const manifest = await fetchJson(cfg.manifestUrl);
    const latest = String((manifest && manifest.version) || '').trim();
    if (!latest) throw new Error('清单缺少 version 字段');
    const fresh = {
      latest,
      url: String(manifest.url || '').trim(),
      sha256: String(manifest.sha256 || '').trim(),
      notes: String(manifest.notes || ''),
      builtAt: manifest.builtAt || null,
      checkedAt: new Date().toISOString(),
    };
    try {
      writeJson(CACHE_FILE, fresh);
    } catch { /* 缓存写不了不影响本次结果 */ }
    return { ...base, error: null, ...snapshot(fresh, current.version) };
  } catch (e) {
    return { ...base, error: (e && e.message) || String(e) };
  }
}

module.exports = { fetchJson, snapshot, checkNow };
