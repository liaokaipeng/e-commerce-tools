'use strict';
// Shopee 开放平台接口目录（离线）：解析 docs/shopee_api_doc/_raw/doc_module_v2.json 得到全部接口，
// 并从 docs/shopee_api_doc/api/README.md 的「模块总览」表格取模块中文名（不手抄映射表，保持与文档同源）。
// 同时提供接口名归一化（apiName <-> apiPath）与读写推断（get_/search_ 等视为只读，其余视为写操作）。
const fs = require('fs');
const path = require('path');

const DOC_ROOT = path.join(__dirname, '..', '..', 'docs', 'shopee_api_doc');
const RAW_FILE = path.join(DOC_ROOT, '_raw', 'doc_module_v2.json');
const API_README = path.join(DOC_ROOT, 'api', 'README.md');
const DOC_BASE = 'https://open.shopee.cn/documents/v2/';
const REGEN_HINT = `（可运行 node docs/shopee_api_doc/_tools/fetch-docs.js 重新生成）`;

// 只读接口前缀：官方查询类接口名基本以这些动词开头（get_/search_/query_/list_…）
const READ_RE = /^(get|search|query|list|fetch|view|check|download)/;

let cache = null;

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

/** 加载并缓存接口目录：{ modules, apis } */
function loadCatalog() {
  if (cache) return cache;
  const zh = moduleZhMap();
  const raw = readRawCatalog();
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
      const method = inferMethod(apiName);
      apis.push({
        apiName,
        apiPath: '/api/' + apiName.split('.').join('/'),
        method,
        read: method === 'GET',
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

/** 描述单个接口（未收录时仍按命名推断方法并给出标记） */
function describe(input) {
  const { apiName, apiPath } = normalizeApi(input);
  const entry = findApi(apiName);
  const method = entry ? entry.method : inferMethod(apiName);
  return {
    apiName,
    apiPath,
    method,
    read: method === 'GET',
    inCatalog: !!entry,
    moduleId: entry ? entry.moduleId : null,
    module: entry ? entry.moduleZh : '',
    moduleName: entry ? entry.moduleName : '',
    docUrl: entry ? entry.docUrl : null,
  };
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
    out = out.filter((a) => a.apiName.toLowerCase().includes(kw) || String(a.moduleZh).toLowerCase().includes(kw));
  }
  if (!opts.writes) out = out.filter((a) => a.read);
  return out.map((a) => ({
    apiName: a.apiName,
    apiPath: a.apiPath,
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
  describe,
  inferMethod,
  apiNameOf,
};
