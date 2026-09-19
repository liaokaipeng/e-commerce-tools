'use strict';
// Shopee 开放平台接口目录（离线）：
//   - 解析 docs/shopee_api_doc/_raw/doc_module_v2.json 得到全部接口；
//   - 从 docs/shopee_api_doc/api/README.md 的「模块总览」表格取模块中文名（不手抄映射表，保持与文档同源）；
//   - 解析 docs/shopee_api_doc/_raw/api_meta_v2.json（接口元数据）：HTTP 方法 / 必填参数 / 分页键 / 错误码 / 限流。
//
// 方法判定口径：**优先用元数据**（详情里的 method 字段，1=POST 写、2=GET 读），
// 元数据缺失或该接口未收录时，回退按接口名动词推断（get_/search_ 等视为只读）。
// 动词推断会误伤 batch_get_* 这类只读接口（如实测 v2.ams.batch_get_products_suggested_rate 是 GET），
// 所以只要 api_meta_v2.json 在，就应以元数据为准。
const fs = require('fs');
const path = require('path');

const DOC_ROOT = path.join(__dirname, '..', '..', 'docs', 'shopee_api_doc');
const RAW_FILE = path.join(DOC_ROOT, '_raw', 'doc_module_v2.json');
const META_FILE = path.join(DOC_ROOT, '_raw', 'api_meta_v2.json');
const API_README = path.join(DOC_ROOT, 'api', 'README.md');
const DOC_BASE = 'https://open.shopee.cn/documents/v2/';
const REGEN_HINT = `（可运行 node docs/shopee_api_doc/_tools/fetch-docs.js 重新生成）`;

// 只读接口前缀：官方查询类接口名基本以这些动词开头（get_/search_/query_/list_…）
const READ_RE = /^(get|search|query|list|fetch|view|check|download)/;

let cache = null;
let metaCache = null;

/** 由接口名推断 HTTP 方法：查询类用 GET，其余（写操作）用 POST */
function inferMethod(apiName) {
  const last = String(apiName || '').split('.').pop() || '';
  return READ_RE.test(last) ? 'GET' : 'POST';
}

/** /api/v2/product/get_item_list -> v2.product.get_item_list */
function apiNameOf(apiPath) {
  let p = String(apiPath || '').trim();
  if (p.startsWith('/api/')) p = p.slice('/api/'.length);
  return p.split('/').join('.');
}

/**
 * 归一化用户输入（三种写法均接受）为 { apiName, apiPath }：
 *   v2.product.get_item_list / /api/v2/product/get_item_list / product.get_item_list
 */
function normalizeApi(input) {
  let s = String(input || '').trim();
  if (!s) throw new Error('缺少接口名或接口路径');
  while (s.endsWith('/')) s = s.slice(0, -1);
  let apiPath;
  if (s.startsWith('/api/')) {
    apiPath = s;
  } else {
    const name = s.startsWith('v2.') ? s : 'v2.' + s;
    apiPath = '/api/' + name.split('.').join('/');
  }
  return { apiName: apiNameOf(apiPath), apiPath };
}

/** 模块中文名映射：module_id -> 中文名（解析 api/README.md 的模块总览表；失败返回空表） */
function moduleZhMap() {
  const out = {};
  let text = '';
  try {
    text = fs.readFileSync(API_README, 'utf8');
  } catch (e) {
    return out;
  }
  const re = /^\|\s*\[`?([^\]`|]+)`?\]\([^)]*\)\s*\|\s*([^|]+?)\s*\|\s*(\d+)\s*\|/gm;
  let m;
  while ((m = re.exec(text)) !== null) {
    const id = Number(m[3]);
    const zh = String(m[2]).trim();
    if (id && zh) out[id] = zh;
  }
  return out;
}

function readRawCatalog() {
  let text;
  try {
    text = fs.readFileSync(RAW_FILE, 'utf8');
  } catch (e) {
    throw new Error(`接口目录文件不存在或不可读：${RAW_FILE}${REGEN_HINT}`);
  }
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error(`接口目录 JSON 解析失败：${RAW_FILE}${REGEN_HINT}`);
  }
}

/**
 * 加载接口元数据（api_meta_v2.json）：{ apis, available, generatedAt }。
 * 文件缺失 / 损坏时 available=false（回退到接口名动词推断），不抛错——保证目录仍可用。
 */
function loadMeta() {
  if (metaCache) return metaCache;
  let text;
  try {
    text = fs.readFileSync(META_FILE, 'utf8');
  } catch (e) {
    metaCache = { apis: {}, available: false, generatedAt: '', count: 0 };
    return metaCache;
  }
  try {
    const raw = JSON.parse(text);
    metaCache = {
      apis: (raw && raw.apis) || {},
      available: true,
      generatedAt: (raw && raw.generatedAt) || '',
      count: (raw && raw.count) || Object.keys((raw && raw.apis) || {}).length,
    };
  } catch (e) {
    metaCache = { apis: {}, available: false, generatedAt: '', count: 0 };
  }
  return metaCache;
}

/** 单个接口的元数据（未收录返回 null） */
function metaOf(input) {
  const { apiName } = normalizeApi(input);
  return loadMeta().apis[apiName] || null;
}

/** 方法判定：优先元数据，其次按名称推断。返回 { method, source }（source: metadata | name） */
function methodOf(apiName) {
  const m = loadMeta().apis[apiName];
  if (m && (m.method === 'GET' || m.method === 'POST')) return { method: m.method, source: 'metadata' };
  return { method: inferMethod(apiName), source: 'name' };
}

/** 必填参数名列表；无元数据返回 null（未知，不据此拦截） */
function requiredParams(apiName) {
  const m = loadMeta().apis[apiName];
  if (!m || !Array.isArray(m.request)) return null;
  return m.request.filter((p) => p.required).map((p) => p.name);
}

/** 已知请求参数名列表；无元数据返回 null（未知） */
function knownParams(apiName) {
  const m = loadMeta().apis[apiName];
  if (!m || !Array.isArray(m.request)) return null;
  return m.request.map((p) => p.name);
}

/** 元数据可用性（供 CLI 提示「元数据缺失，方法按名称推断」） */
function metaInfo() {
  const m = loadMeta();
  return { available: m.available, generatedAt: m.generatedAt, count: m.count };
}

/** 加载并缓存接口目录：{ modules, apis } */
function loadCatalog() {
  if (cache) return cache;
  const zh = moduleZhMap();
  const raw = readRawCatalog();
  const apisMap = loadMeta().apis;
  const modules = [];
  const apis = [];
  for (const m of raw.modules || []) {
    const moduleId = m.module_id;
    const moduleName = String(m.module_name || '');
    const moduleZh = zh[moduleId] || moduleName;
    let count = 0;
    for (const it of m.items || []) {
      // type === 1 为接口条目，type === 2 为指南条目
      if (it.type !== 1) continue;
      const apiName = String(it.name || '');
      if (!apiName.startsWith('v2.')) continue;
      const mo = methodOf(apiName);
      apis.push({
        apiName,
        apiPath: '/api/' + apiName.split('.').join('/'),
        method: mo.method,
        methodSource: mo.source,
        read: mo.method === 'GET',
        hasMeta: !!apisMap[apiName],
        moduleId,
        moduleName,
        moduleZh,
        itemId: it.id,
        docUrl: `${DOC_BASE}${apiName}?module=${moduleId}&type=1`,
      });
      count++;
    }
    modules.push({ moduleId, moduleName, moduleZh, count });
  }
  apis.sort((a, b) => a.apiName.localeCompare(b.apiName));
  cache = { modules, apis };
  return cache;
}

/** 按接口名/路径在目录中查找条目，未收录返回 null */
function findApi(input) {
  const { apiName } = normalizeApi(input);
  const { apis } = loadCatalog();
  return apis.find((a) => a.apiName === apiName) || null;
}

/**
 * 解析用户输入为接口条目（agent 提速：允许短名，省一次 search 往返）：
 *   1) 精确匹配（v2.order.get_order_list / 完整路径）；
 *   2) 短名唯一匹配：`get_order_list` / `order.get_order_list`（去掉 v2. 前缀后按末段/后缀比对，
 *      大小写不敏感）；唯一命中直接用，多个命中抛错并列出候选（报错即 search 结果）；
 *   3) 零命中：返回 entry=null（保持「未收录也能按命名推断继续」的既有语义）。
 * @returns {{ apiName, apiPath, entry: object|null, matched: 'exact'|'suffix'|'none' }}
 */
function resolveApi(input) {
  const { apiName, apiPath } = normalizeApi(input);
  const { apis } = loadCatalog();
  const exact = apis.find((a) => a.apiName === apiName) || null;
  if (exact) return { apiName, apiPath, entry: exact, matched: 'exact' };
  const bare = String(input || '').trim().replace(/^v2\./i, '').toLowerCase();
  if (!bare) throw new Error('缺少接口名或接口路径');
  const hits = apis.filter((a) => {
    const n = a.apiName.slice(3).toLowerCase(); // 去掉 v2. 前缀
    return n === bare || n.endsWith('.' + bare);
  });
  if (hits.length === 1) {
    return { apiName: hits[0].apiName, apiPath: hits[0].apiPath, entry: hits[0], matched: 'suffix' };
  }
  if (hits.length > 1) {
    const names = hits.slice(0, 8).map((h) => '  ' + h.apiName).join('\n');
    const more = hits.length > 8 ? `\n  …共 ${hits.length} 个` : '';
    throw new Error(`「${input}」匹配到 ${hits.length} 个接口，请用完整接口名重试：\n${names}${more}`);
  }
  return { apiName, apiPath, entry: null, matched: 'none' };
}

/** 描述单个接口（未收录时仍按命名/元数据给出方法，并带 inCatalog 标记）。
 *  默认输出瘦身版参数表（name/type/required/sample，省 token）；full=true 时输出完整元数据。 */
function describe(input, opts = {}) {
  const { apiName, apiPath, entry } = resolveApi(input);
  const mo = methodOf(apiName);
  const meta = metaOf(apiName);
  const out = {
    apiName,
    apiPath,
    method: mo.method,
    methodSource: mo.source,
    read: mo.method === 'GET',
    inCatalog: !!entry,
    moduleId: entry ? entry.moduleId : null,
    module: entry ? entry.moduleZh : '',
    moduleName: entry ? entry.moduleName : '',
    docUrl: entry ? entry.docUrl : null,
  };
  if (meta) {
    out.required = (meta.request || []).filter((p) => p.required).map((p) => p.name);
    out.optional = (meta.request || []).filter((p) => !p.required).map((p) => p.name);
    out.params = (meta.request || []).map((p) => (opts.full
      ? p
      : { name: p.name, type: p.type, required: !!p.required, sample: p.sample }));
    out.paging = meta.paging || { style: '', keys: [], listKeys: [] };
    out.errors = meta.errors || [];
    out.rateLimit = meta.rateLimit || '';
  }
  return out;
}

/** 模块名/ID -> 模块对象 */
function resolveModule(input, modules) {
  const s = String(input || '').trim();
  const byId = modules.find((m) => String(m.moduleId) === s);
  if (byId) return byId;
  const low = s.toLowerCase();
  const hit = modules.find((m) => m.moduleName.toLowerCase() === low || m.moduleZh === s)
    || modules.find((m) => m.moduleName.toLowerCase().includes(low) || String(m.moduleZh).includes(s));
  if (!hit) throw new Error(`未找到模块：${input}（可运行 node shopee_skill/cli.js list --modules 查看全部模块）`);
  return hit;
}

/**
 * 列出接口。默认只列查询类（read），--writes 时一并列出写操作。
 * 关键词匹配接口名 / 接口路径 / 模块中文名 / 模块英文名。
 * 输出仅保留 agent 需要的字段（apiPath 可由 apiName 推导、methodSource 是噪音，均省 token）。
 * @param {object} opts { module?, keyword?, writes? }
 */
function listApis(opts = {}) {
  const { modules, apis } = loadCatalog();
  let out = apis;
  if (opts.module) {
    const mod = resolveModule(opts.module, modules);
    out = out.filter((a) => a.moduleId === mod.moduleId);
  }
  if (opts.keyword) {
    const kw = String(opts.keyword).toLowerCase();
    out = out.filter((a) => a.apiName.toLowerCase().includes(kw)
      || a.apiPath.toLowerCase().includes(kw)
      || String(a.moduleZh).toLowerCase().includes(kw)
      || String(a.moduleName).toLowerCase().includes(kw));
  }
  if (!opts.writes) out = out.filter((a) => a.read);
  return out.map((a) => ({
    apiName: a.apiName,
    method: a.method,
    read: a.read,
    module: a.moduleZh,
  }));
}

module.exports = {
  loadCatalog,
  listApis,
  normalizeApi,
  findApi,
  resolveApi,
  describe,
  inferMethod,
  apiNameOf,
  metaOf,
  methodOf,
  requiredParams,
  knownParams,
  metaInfo,
};
