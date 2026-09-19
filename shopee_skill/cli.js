#!/usr/bin/env node
'use strict';
// Shopee 数据查询 CLI（独立运行，无需启动 8765 服务）。
// 复用仓库既有底座：server/openapi/client 的 callOpenApi（自动签名 / 附带 token / 过期刷新），
// 凭证沿用 server/data/openapi-session.json（与「开放平台」页授权共用，gitignored）。
//
// 用法：node shopee_skill/cli.js <命令> [选项]
//   shops [--names] [--all-shops]       列出已授权店铺（默认只列重点店铺；--names 会打网关补店铺名）
//   list [--module <ID|名称>] [--keyword <kw>] [--writes] [--modules]
//   search <关键词>                      等价 list --keyword
//   describe <接口名|路径>               查看接口元数据与官方文档链接
//   call <接口名|路径> --shop <ID|all> [--params '<json>'] [--param k=v ...]
//        [--params-file <path>] [--method GET|POST] [--all] [--max-pages N]
//        [--allow-write] [--raw] [--all-shops]
//   help
//
// 红线：默认只读 —— 非查询类接口（写操作）必须显式 --allow-write 才会调用；
//       不对外暴露 token 刷新入口（刷新由 callOpenApi 内部按共享 token 组语义自动处理）。
const fs = require('fs');
const { parse, bool, intOf } = require('./lib/args');
const catalog = require('./lib/catalog');
const { callWithPaging } = require('./lib/paging');
const { extractPayload, print, fail } = require('./lib/output');

const USAGE = [
  'Shopee 数据查询 CLI（复用仓库开放平台凭证，无需启动服务）',
  '',
  '用法：node shopee_skill/cli.js <命令> [选项]',
  '',
  '命令：',
  '  shops [--names] [--all-shops]    列出已授权店铺（默认只列「重点店铺」）',
  '  list [--module <ID|名称>] [--keyword <kw>] [--writes] [--modules]',
  '                                   列出接口目录（默认只列查询类；--writes 含写操作）',
  '  search <关键词>                   在接口名/模块名中搜索（等价 list --keyword）',
  '  describe <接口名|路径>            查看接口元数据、方法与官方文档链接',
  '  call <接口名|路径> --shop <ID|all>  调用接口并输出数据（详见下方选项）',
  '  help                             显示本说明',
  '',
  'call 选项：',
  '  --shop <ID|all>   目标店铺；仅一个已授权店铺时可省略；all 表示重点店铺（未标记任何重点店铺时为全部）',
  '  --all-shops       忽略「重点店铺」筛选：--shop all 针对全部已授权店铺',
  '  --params <json>   业务参数 JSON，如 --params \'{"item_id":123}\'',
  '  --param k=v       单个业务参数，可重复；值自动按 JSON 标量解析',
  '  --params-file <p> 从文件读取业务参数 JSON（对象）',
  '  --method GET|POST 显式指定方法（默认按接口名推断：get_/search_ 等为 GET）',
  '  --all             自动翻页拉全量（自适应 cursor / offset / page_no）',
  '  --max-pages <n>   自动翻页上限，默认 10',
  '  --allow-write     放行写操作接口（默认只读拦截）',
  '  --raw             输出网关原始响应（含 error / message / request_id）',
  '',
  '示例：',
  '  node shopee_skill/cli.js shops --names',
  '  node shopee_skill/cli.js search order',
  '  node shopee_skill/cli.js describe v2.product.get_item_list',
  '  node shopee_skill/cli.js call v2.shop.get_shop_info --shop 123456',
  "  node shopee_skill/cli.js call v2.order.get_order_list --shop all --all --params '{\"order_status\":\"READY_TO_SHIP\",\"time_range_field\":\"create_time\",\"time_from\":1700000000,\"time_to\":1800000000,\"page_size\":100}'",
].join('\n');

function cmdShops(flags) {
  const store = require('../server/openapi/store');
  const st = store.status();
  if (!st.configured) {
    print({
      configured: false,
      env: '',
      count: 0,
      shops: [],
      message: '尚未配置开放平台 App，请先在工具的「开放平台」页面保存 partner_id / partner_key',
    });
    return Promise.resolve();
  }
  // 「重点店铺」筛选：有标记且未加 --all-shops 时只列出重点店铺（与监控大屏取店范围一致）；
  // 一个都没标记则回落为全部已授权店铺。
  const importantSet = new Set(store.getImportantIds(st.env));
  const onlyImportant = importantSet.size > 0 && !bool(flags['all-shops']);
  const source = onlyImportant ? st.shops.filter((s) => importantSet.has(s.shopId)) : st.shops;
  const meta = {
    configured: true,
    env: st.env,
    count: source.length,
    importantCount: importantSet.size,
    onlyImportant,
    filterNote: onlyImportant
      ? '仅列出「重点店铺」（在「开放平台」页面勾选）；如需全部店铺请加 --all-shops'
      : (importantSet.size ? '未筛选（--all-shops）' : '未标记任何重点店铺，按全部已授权店铺处理'),
  };
  let shops = source.map((s) => ({
    shopId: s.shopId,
    env: s.env,
    state: s.state,
    important: !!s.important,
    accessExpireAt: s.accessExpireAt,
    remainSec: s.remainSec,
    invalid: !!s.invalid,
    invalidReason: s.invalidReason || '',
  }));
  if (!bool(flags.names)) {
    print(Object.assign({}, meta, { shops }));
    return Promise.resolve();
  }
  // --names：经 authorizedStores 补店铺名/地区（会对缺名店铺调 get_shop_info，产生少量网关请求）
  return Promise.resolve()
    .then(() => require('../server/openapi/stores-view').authorizedStores())
    .then((list) => {
      const map = {};
      for (const it of list) map[String(it.id)] = { name: it.name, region: it.region };
      shops = shops.map((s) => Object.assign({}, s, map[s.shopId] || {}));
      print(Object.assign({}, meta, {
        shops,
        note: '已尝试经 get_shop_info 补店铺名/地区（可能产生少量网关请求）',
      }));
    });
}

function cmdList(flags) {
  const { modules } = catalog.loadCatalog();
  if (bool(flags.modules)) {
    print(modules.map((m) => ({ moduleId: m.moduleId, module: m.moduleZh, moduleName: m.moduleName, count: m.count })));
    return;
  }
  const rows = catalog.listApis({ module: flags.module, keyword: flags.keyword, writes: bool(flags.writes) });
  print(rows);
}

function cmdSearch(positional, flags) {
  const kw = positional[1];
  if (!kw) throw new Error('用法：node shopee_skill/cli.js search <关键词>');
  print(catalog.listApis({ keyword: kw, writes: bool(flags.writes) }));
}

function cmdDescribe(positional) {
  const api = positional[1];
  if (!api) throw new Error('用法：node shopee_skill/cli.js describe <接口名|路径>');
  print(catalog.describe(api));
}

/** 解析 --params / --params-file / --param 得到业务参数对象（后者覆盖前者） */
function buildBusiness(flags) {
  let business = {};
  if (flags['params-file']) {
    const p = String(flags['params-file']);
    let text;
    try {
      text = fs.readFileSync(p, 'utf8');
    } catch (e) {
      throw new Error('读取参数文件失败：' + p);
    }
    let obj;
    try {
      obj = JSON.parse(text);
    } catch (e) {
      throw new Error('参数文件不是合法 JSON：' + p);
    }
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new Error('参数文件内容必须是 JSON 对象：' + p);
    business = obj;
  }
  if (flags.params !== undefined && flags.params !== true) {
    let obj;
    try {
      obj = JSON.parse(String(flags.params));
    } catch (e) {
      throw new Error('--params 不是合法 JSON：' + flags.params);
    }
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
      throw new Error("--params 必须是 JSON 对象，例如 --params '{\"item_id\":123}'");
    }
    business = Object.assign(business, obj);
  }
  const pairs = Array.isArray(flags.param) ? flags.param : flags.param !== undefined ? [flags.param] : [];
  for (const kv of pairs) {
    const s = String(kv);
    const i = s.indexOf('=');
    if (i <= 0) throw new Error('--param 需形如 k=v，收到：' + s);
    business[s.slice(0, i).trim()] = parseScalar(s.slice(i + 1));
  }
  return business;
}

/** 标量解析：true/false/null/数字原样，JSON 对象/数组解析，其余按字符串 */
function parseScalar(v) {
  const s = String(v);
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (s === 'null') return null;
  if (s !== '' && !Number.isNaN(Number(s))) return Number(s);
  if ((s.startsWith('{') && s.endsWith('}')) || (s.startsWith('[') && s.endsWith(']'))) {
    try {
      return JSON.parse(s);
    } catch (e) {
      return s;
    }
  }
  return s;
}

/** 解析目标店铺：未指定时按「仅一个已授权店铺」自动选用；all 表示全部有效店铺（受「重点店铺」筛选约束） */
function resolveShops(input, flags) {
  const store = require('../server/openapi/store');
  const st = store.status();
  if (!st.configured) throw new Error('尚未配置开放平台 App，请先在工具的「开放平台」页面保存 partner_id / partner_key');
  const allIds = st.shops.map((s) => s.shopId);
  // 「重点店铺」筛选：有标记且未加 --all-shops 时，all / 自动选店只作用于重点店铺；
  // 显式 --shop <ID> 不受影响（仍可单独指定任意已授权店铺）。
  const importantSet = new Set(store.getImportantIds(st.env));
  const onlyImportant = importantSet.size > 0 && !bool(flags && flags['all-shops']);
  let available = st.shops.filter((s) => !s.invalid).map((s) => s.shopId);
  if (onlyImportant) {
    const filtered = available.filter((id) => importantSet.has(id));
    if (filtered.length) available = filtered; // 重点店铺全部失效时回落为全部有效店铺，避免无目标可调
  }
  if (input && String(input).toLowerCase() === 'all') {
    if (!available.length) throw new Error('当前环境没有已授权店铺，请先在「开放平台」页面完成店铺授权');
    return available;
  }
  if (input) {
    const id = String(input);
    const hit = st.shops.find((s) => s.shopId === id);
    if (!hit) throw new Error(`店铺 ${id} 未授权（当前环境 ${st.env} 已授权：${allIds.join(', ') || '无'}）`);
    if (hit.invalid) {
      throw new Error(`店铺 ${id} 授权已失效：${hit.invalidReason || '凭证无效'}，请在「开放平台」页面重新授权`);
    }
    return [id];
  }
  if (available.length === 1) return [available[0]];
  if (!available.length) throw new Error('当前环境没有已授权店铺，请先在「开放平台」页面完成店铺授权');
  throw new Error(`存在多个已授权店铺，请用 --shop <店铺ID> 指定或 --shop all；候选：${available.join(', ')}`);
}

async function cmdCall(positional, flags) {
  const api = positional[1];
  if (!api) {
    throw new Error("用法：node shopee_skill/cli.js call <接口名|路径> --shop <店铺ID|all> [--params '{...}']");
  }
  const { apiName, apiPath } = catalog.normalizeApi(api);
  const entry = catalog.findApi(apiName);
  const method = String(flags.method || (entry ? entry.method : catalog.inferMethod(apiName))).toUpperCase();
  if (method !== 'GET' && !bool(flags['allow-write'])) {
    throw new Error(
      `接口 ${apiName} 被判定为写操作（方法 ${method}），默认只读已拦截；`
      + '如确需调用请确认影响后加 --allow-write'
    );
  }
  const business = buildBusiness(flags);
  const maxPages = intOf(flags['max-pages'], 10);
  const all = bool(flags.all);
  const raw = bool(flags.raw);
  const targets = resolveShops(flags.shop, flags);
  const results = {};
  for (const shopId of targets) {
    try {
      const j = await callWithPaging({ apiPath, business, shopId, method, all, maxPages });
      results[shopId] = raw ? j : extractPayload(j);
    } catch (e) {
      if (targets.length === 1) throw e;
      results[shopId] = { __error: e.message };
    }
  }
  print(targets.length === 1 ? results[targets[0]] : results);
}

/** 命令分发 */
async function run(argv) {
  const { _, flags } = parse(argv);
  const cmd = String(_[0] || (flags.help ? 'help' : '')).toLowerCase();
  if (flags.help || !cmd || cmd === 'help') {
    print({ ok: true, usage: USAGE });
    return;
  }
  if (cmd === 'shops') return cmdShops(flags);
  if (cmd === 'list') return cmdList(flags);
  if (cmd === 'search') return cmdSearch(_, flags);
  if (cmd === 'describe') return cmdDescribe(_);
  if (cmd === 'call') return cmdCall(_, flags);
  throw new Error(`未知命令：${cmd}（可用：shops / list / search / describe / call / help）`);
}

run(process.argv.slice(2)).catch((e) => {
  let hint = '';
  try {
    const client = require('../server/openapi/client');
    if (client.isAuthDead(e && e.message)) {
      hint = '该店铺凭证已失效，请到工具的「开放平台」页面重新授权后重试';
    }
  } catch (e2) { /* 客户端不可用时忽略提示 */ }
  fail(e && e.message ? e.message : e, hint);
  if (process.env.KP_SHOPEE_SKILL_DEBUG) console.error(e && e.stack);
});
