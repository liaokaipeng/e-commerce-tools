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
//   describe <接口名|路径>               查看接口元数据（方法 / 参数 / 分页 / 错误码）与官方文档链接
//   call <接口名|路径> --shop <ID|all> [选项]
//   help
//
// 红线：默认只读 —— 写操作（按官方文档元数据判定）必须显式 --allow-write 才会调用（--dry-run 只预览不拦截）；
//       不对外暴露 token 刷新入口（刷新由 callOpenApi 内部按共享 token 组语义自动处理）。
// --shop all 时跨店并发执行（同店内翻页仍串行）。限流按店铺维度，跨店并发安全。
const fs = require('fs');
const { parse, bool, intOf } = require('./lib/args');
const catalog = require('./lib/catalog');
const { callWithPaging } = require('./lib/paging');
const { extractPayload, print, fail, warn, selectPath } = require('./lib/output');
const { applyHelpers } = require('./lib/time');

// 跨店并发度：与开放平台其它 fan-out 同量级（stores-view 取名并发 5、监控按店采集 3）
const CALL_SHOP_CONCURRENCY = 5;
const MAX_SHOP_CONCURRENCY = 20;
// 公共参数由底座自动附带，不计入「必填业务参数」校验
const COMMON_PARAMS = new Set(['shop_id', 'partner_id', 'access_token', 'timestamp', 'sign']);

const USAGE = [
  'Shopee 数据查询 CLI（复用仓库开放平台凭证，无需启动服务）',
  '',
  '用法：node shopee_skill/cli.js <命令> [选项]',
  '',
  '命令：',
  '  shops [--names] [--all-shops]    列出已授权店铺（默认只列「重点店铺」）',
  '  list [--module <ID|名称>] [--keyword <kw>] [--writes] [--modules]',
  '                                   列出接口目录（默认只列查询类；--writes 含写操作）',
  '  search <关键词>                   在接口名/路径/模块名中搜索（等价 list --keyword）',
  '  describe <接口名|路径>            查看接口方法、参数表、分页键、错误码与官方文档链接',
  '  call <接口名|路径> --shop <ID|all>  调用接口并输出数据（详见下方选项）',
  '  help                             显示本说明',
  '',
  'call 选项：',
  '  --shop <ID|all>   目标店铺；仅一个已授权店铺时可省略；all 表示重点店铺（未标记任何重点店铺时为全部）',
  '  --all-shops       忽略「重点店铺」筛选：--shop all 针对全部已授权店铺',
  '  --params <json>   业务参数 JSON，如 --params \'{"item_id":123}\'',
  '  --param k=v       单个业务参数，可重复；值自动按 JSON 标量解析',
  '  --params-file <p> 从文件读取业务参数 JSON（对象）',
  '  --method GET|POST 显式指定方法（默认取官方文档元数据，缺失时按接口名推断）',
  '  --last <dur>      时间窗：最近 N 时长（7d / 24h / 30m），自动补 time_from/time_to/time_range_field',
  '  --from <t> / --to <t>  时间窗端点：epoch 秒 / 13 位毫秒 / ISO 日期 / -7d（相对现在）',
  '  --page-size <n>   page_size 简写',
  '  --all             自动翻页拉全量（自适应 cursor / offset / page_no，默认上限 10 页）',
  '  --max-pages <n>   自动翻页上限，默认 10；显式 0 表示不翻页（只要首屏）',
  '  --concurrency <n> --shop all 时的跨店并发度，默认 5（上限 20）',
  '  --select <path>   只输出指定路径（点分，支持数组下标），如 orders.0.order_sn',
  '  --dry-run         只打印将发送的方法/路径/参数，不签名、不发包（写操作也可预览）',
  '  --allow-write     放行写操作接口（默认只读拦截）',
  '  --raw             输出网关原始响应（含 error / message / request_id）',
  '  --wrap            统一输出信封 { ok, apiName, method, data|shops }',
  '  --fail-on-error   多店部分失败时置非零退出码',
  '  --compact         紧凑 JSON（不加缩进，省 token）',
  '',
  '示例：',
  '  node shopee_skill/cli.js shops --names',
  '  node shopee_skill/cli.js search order',
  '  node shopee_skill/cli.js describe v2.product.get_item_list',
  '  node shopee_skill/cli.js call v2.shop.get_shop_info --shop 123456',
  '  node shopee_skill/cli.js call v2.order.get_order_list --shop 123456 --last 7d --all --page-size 100',
  '  node shopee_skill/cli.js call v2.discount.add_discount --shop 123456 --params \'{...}\' --dry-run',
].join('\n');

/** 紧凑输出（--compact 时 JSON 不加缩进，省 token） */
function emit(value, flags) {
  print(value, { compact: bool(flags.compact) });
}

function normConcurrency(v) {
  const n = intOf(v, CALL_SHOP_CONCURRENCY);
  if (!Number.isFinite(n) || n < 1) return CALL_SHOP_CONCURRENCY;
  return Math.min(n, MAX_SHOP_CONCURRENCY);
}

function cmdShops(flags) {
  const store = require('../server/openapi/store');
  const st = store.status();
  if (!st.configured) {
    emit({
      configured: false,
      env: '',
      count: 0,
      shops: [],
      message: '尚未配置开放平台 App，请先在工具的「开放平台」页面保存 partner_id / partner_key',
    }, flags);
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
    emit(Object.assign({}, meta, { shops }), flags);
    return Promise.resolve();
  }
  // --names：经 authorizedStores 补店铺名/地区（会对缺名店铺调 get_shop_info，产生少量网关请求）
  return Promise.resolve()
    .then(() => require('../server/openapi/stores-view').authorizedStores())
    .then((list) => {
      const map = {};
      for (const it of list) map[String(it.id)] = { name: it.name, region: it.region };
      shops = shops.map((s) => Object.assign({}, s, map[s.shopId] || {}));
      emit(Object.assign({}, meta, {
        shops,
        note: '已尝试经 get_shop_info 补店铺名/地区（可能产生少量网关请求）',
      }), flags);
    });
}

function cmdList(flags) {
  const { modules } = catalog.loadCatalog();
  if (bool(flags.modules)) {
    emit(modules.map((m) => ({ moduleId: m.moduleId, module: m.moduleZh, moduleName: m.moduleName, count: m.count })), flags);
    return;
  }
  const rows = catalog.listApis({ module: flags.module, keyword: flags.keyword, writes: bool(flags.writes) });
  emit(rows, flags);
}

function cmdSearch(positional, flags) {
  const kw = positional[1];
  if (!kw) throw new Error('用法：node shopee_skill/cli.js search <关键词>');
  emit(catalog.listApis({ keyword: kw, writes: bool(flags.writes) }), flags);
}

function cmdDescribe(positional, flags) {
  const api = positional[1];
  if (!api) throw new Error('用法：node shopee_skill/cli.js describe <接口名|路径>');
  emit(catalog.describe(api), flags);
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
  // 店铺多时不要把所有 ID 倒进报错里（本机实测有 60+ 已授权店铺），只列前 8 个
  const brief = (ids) => (ids.length > 8 ? ids.slice(0, 8).join(', ') + ` 等 ${ids.length} 个` : ids.join(', '));
  // 「重点店铺」筛选：有标记且未加 --all-shops 时，all / 自动选店只作用于重点店铺；
  // 显式 --shop <ID> 不受影响（仍可单独指定任意已授权店铺）。
  const importantSet = new Set(store.getImportantIds(st.env));
  const onlyImportant = importantSet.size > 0 && !bool(flags && flags['all-shops']);
  let available = st.shops.filter((s) => !s.invalid).map((s) => s.shopId);
  if (onlyImportant) {
    const filtered = available.filter((id) => importantSet.has(id));
    // 不静默扩大到全部店铺：重点店铺全部失效时明确报错，避免写操作打到预期外的店
    if (!filtered.length) {
      throw new Error('已勾选的「重点店铺」当前均无有效凭证；请到「开放平台」页面重新授权，或加 --all-shops 以对全部已授权店铺执行');
    }
    available = filtered;
  }
  if (input && String(input).toLowerCase() === 'all') {
    if (!available.length) throw new Error('当前环境没有已授权店铺，请先在「开放平台」页面完成店铺授权');
    return available;
  }
  if (input) {
    const id = String(input);
    const hit = st.shops.find((s) => s.shopId === id);
    if (!hit) throw new Error(`店铺 ${id} 未授权（当前环境 ${st.env} 已授权 ${allIds.length} 个：${brief(allIds) || '无'}）`);
    if (hit.invalid) {
      throw new Error(`店铺 ${id} 授权已失效：${hit.invalidReason || '凭证无效'}，请在「开放平台」页面重新授权`);
    }
    return [id];
  }
  if (available.length === 1) return [available[0]];
  if (!available.length) throw new Error('当前环境没有已授权店铺，请先在「开放平台」页面完成店铺授权');
  throw new Error(`存在多个已授权店铺，请用 --shop <店铺ID> 指定或 --shop all；候选：${brief(available)}`);
}

async function cmdCall(positional, flags) {
  const api = positional[1];
  if (!api) {
    throw new Error("用法：node shopee_skill/cli.js call <接口名|路径> --shop <店铺ID|all> [--params '{...}']");
  }
  const { apiName, apiPath } = catalog.normalizeApi(api);
  const entry = catalog.findApi(apiName);
  const meta = catalog.metaOf(apiName);
  const mo = (flags.method !== undefined && flags.method !== true)
    ? { method: String(flags.method).toUpperCase(), source: 'flag' }
    : catalog.methodOf(apiName);
  const method = mo.method;
  const dryRun = bool(flags['dry-run']);
  const allowWrite = bool(flags['allow-write']);

  // 写操作默认拦截（--dry-run 只是预览，不拦截）
  if (method !== 'GET' && !allowWrite && !dryRun) {
    const src = mo.source === 'metadata' ? '官方文档元数据' : mo.source === 'flag' ? '--method' : '接口名推断';
    throw new Error(
      `接口 ${apiName} 被判定为写操作（方法 ${method}，判定来源：${src}），默认只读已拦截；`
      + '如确需调用请确认影响后加 --allow-write（可先用 --dry-run 预览）'
    );
  }

  const notes = [];
  const metaInfo = catalog.metaInfo();
  if (!entry && !meta) notes.push(`接口 ${apiName} 不在离线目录中：方法按接口名推断，参数不校验`);
  else if (!meta) notes.push(`接口 ${apiName} 无元数据：方法按接口名推断，参数不校验（可运行 node docs/shopee_api_doc/_tools/fetch-docs.js --meta-only 刷新）`);

  const businessRaw = buildBusiness(flags);
  const known = catalog.knownParams(apiName);
  const helped = applyHelpers(businessRaw, flags, known, Math.floor(Date.now() / 1000));
  for (const n of helped.notes) notes.push(n);
  const business = helped.params;

  // 未知参数提示（不拦截，仅提醒可能与网关不一致）
  if (known) {
    const unknown = Object.keys(business).filter((k) => !known.includes(k));
    if (unknown.length) notes.push(`以下参数不在官方参数表中，可能被网关忽略或报错：${unknown.join(', ')}`);
  }
  if (!metaInfo.available) notes.push('接口元数据文件缺失：方法与必填均按名称推断，建议先刷新 api_meta_v2.json');

  // 目标店铺：--dry-run 允许在未配置 App / 未授权时也预览参数（shops 为空并给出 shopsError）
  let targets = [];
  let shopsError = '';
  try {
    targets = resolveShops(flags.shop, flags);
  } catch (e) {
    shopsError = e.message;
  }
  const req = catalog.requiredParams(apiName);
  const missingRequired = req
    ? req.filter((k) => !COMMON_PARAMS.has(k) && (business[k] === undefined || business[k] === null || business[k] === ''))
    : [];

  const wrap = bool(flags.wrap);
  const failOnError = bool(flags['fail-on-error']);
  const raw = bool(flags.raw);
  const select = flags.select !== undefined && flags.select !== true ? String(flags.select) : '';

  // --dry-run：只预览将发送的方法/路径/参数，不签名、不发包（写操作也不拦截）
  if (dryRun) {
    emit(Object.assign({
      ok: true,
      dryRun: true,
      apiName,
      apiPath,
      method,
      methodSource: mo.source,
      read: method === 'GET',
      inCatalog: !!entry,
      allowWrite,
      shops: targets,
      params: business,
      missingRequired,
    }, shopsError ? { shopsError } : {}, notes.length ? { notes } : {}), flags);
    return;
  }

  if (shopsError) throw new Error(shopsError);
  if (missingRequired.length) {
    throw new Error(`接口 ${apiName} 缺少必填参数：${missingRequired.join(', ')}（可运行 describe ${apiName} 查看参数表）`);
  }

  const all = bool(flags.all);
  const maxPages = intOf(flags['max-pages'], 10);
  const conc = normConcurrency(flags.concurrency);

  // 跨店并发：限流按店铺维度，跨店并发安全；同店不并发（翻页在 callWithPaging 内串行）。
  // 结果按下标回填、最后按 targets 顺序组装，避免并发下对象键序不确定。
  const settled = new Array(targets.length);
  let cursor = 0;
  const worker = async () => {
    while (cursor < targets.length) {
      const i = cursor++;
      const shopId = targets[i];
      try {
        const j = await callWithPaging({ apiPath, business, shopId, method, all, maxPages, meta });
        settled[i] = { shopId, value: raw ? j : extractPayload(j) };
      } catch (e) {
        settled[i] = { shopId, error: e };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(conc, targets.length) }, worker));

  const pick = (v) => (select ? selectPath(v, select) : v);

  // 单店：失败直接抛出（保持原语义：错误交给顶层打印并置非零退出码）
  if (targets.length === 1) {
    if (settled[0].error) throw settled[0].error;
    const data = pick(settled[0].value);
    if (select && data === undefined) throw new Error(`--select 路径不存在：${select}`);
    if (wrap) {
      emit(Object.assign({
        ok: true, apiName, apiPath, method, read: method === 'GET', shopId: targets[0], data,
      }, notes.length ? { notes } : {}), flags);
    } else {
      for (const n of notes) warn(n);
      emit(data, flags);
    }
    return;
  }

  // 多店：逐店结果 + 失败清单
  const failed = [];
  const results = {};
  for (const it of settled) {
    if (it.error) {
      failed.push(it.shopId);
      results[it.shopId] = { error: it.error.message };
      continue;
    }
    const picked = pick(it.value);
    if (select && picked === undefined) {
      failed.push(it.shopId);
      results[it.shopId] = { error: `--select 路径不存在：${select}` };
    } else {
      results[it.shopId] = picked;
    }
  }
  if (wrap) {
    emit(Object.assign({
      ok: failed.length === 0,
      apiName,
      apiPath,
      method,
      read: method === 'GET',
      shops: results,
    }, failed.length ? { failed } : {}, notes.length ? { notes } : {}), flags);
  } else {
    const out = {};
    for (const it of settled) out[it.shopId] = it.error ? { __error: it.error.message } : pick(it.value);
    for (const n of notes) warn(n);
    emit(out, flags);
  }
  if (failOnError && failed.length) process.exitCode = 1;
}

/** 命令分发 */
async function run(argv) {
  const { _, flags } = parse(argv);
  const cmd = String(_[0] || (flags.help ? 'help' : '')).toLowerCase();
  if (flags.help || !cmd || cmd === 'help') {
    emit({ ok: true, usage: USAGE }, flags);
    return;
  }
  if (cmd === 'shops') return cmdShops(flags);
  if (cmd === 'list') return cmdList(flags);
  if (cmd === 'search') return cmdSearch(_, flags);
  if (cmd === 'describe') return cmdDescribe(_, flags);
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
