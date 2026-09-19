/**
 * Shopee 开放平台整站目录抓取/生成脚本（零依赖，Node 内置模块）
 *
 * 生成三份产物：
 *   - developer-guide/README.md  开发者指南整站目录（中文）
 *   - api/README.md              API 参考整站目录 v2（中文）
 *   - _raw/api_meta_v2.json      接口元数据（方法 / 必填参数 / 分页键 / 错误码 / 限流）
 *
 * 用法（在 shopee_api_doc 目录执行）：
 *   node _tools/fetch-docs.js              # 抓取官网：两份目录 + 接口元数据
 *   node _tools/fetch-docs.js --meta-only  # 只刷新接口元数据（读 _raw/ 的模块树，不动其它快照）
 *   node _tools/fetch-docs.js --no-meta    # 只抓目录，跳过接口元数据（省 441 次请求）
 *   node _tools/fetch-docs.js --local      # 不访问网络，用 _raw/ 快照重渲染（用于改格式后刷新）
 *
 * 说明：
 *   - 官方页面为 SPA，正文来自 /opservice/api/v1 系列内部接口，本脚本直接取 JSON 生成目录。
 *   - 中文标题优先使用官方中文名（zh-Hans 列表）；官方未提供中文名的条目由本脚本的
 *     中文译名映射（ZH_* 常量）补充，文档中以 † 标注。
 *   - 原始数据快照保存在 _raw/。
 *   - 目录文档保持紧凑：不逐条贴官方链接，链接按规律拼接（见两份 README 头部说明）。
 *   - 接口元数据（api_meta_v2.json）来自 /doc/api/?api_id=<id>：把每个接口的「HTTP 方法、
 *     请求参数与必填、分页键、错误码、限流」提炼出来，供 shopee_skill/cli.js 做方法判定与
 *     调用前参数校验。方法以详情里的 method 字段为准（1=POST 写、2=GET 读）；实测
 *     is_get_method 恒为 0 不可用，仅在 method 缺失时回退解析 request_sample 里的 HTTP 动词。
 */
'use strict';

const https = require('https');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const RAW_DIR = path.join(ROOT, '_raw');
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

const SG = 'https://open.shopee.com'; // 国际站
const CN = 'https://open.shopee.cn'; // 中国站

const DOC_MODULE_API = CN + '/opservice/api/v1/doc/module/?version=2';
const DOC_API_DETAIL = CN + '/opservice/api/v1/doc/api/?api_id=';
const API_META_FILE = path.join(RAW_DIR, 'api_meta_v2.json');
const API_META_CONCURRENCY = 8;

/* ================= 中文译名映射 ================= */

// API 模块中文名（module_id → 中文）
const ZH_MODULE = {
  87: '指南总览',
  127: '联盟营销',
  129: '视频',
  89: '商品',
  90: '全球商品',
  91: '媒体空间',
  130: '媒体',
  92: '店铺',
  93: '商家',
  94: '订单',
  95: '物流',
  96: '首公里',
  97: '支付',
  99: '折扣活动',
  110: '捆绑销售',
  111: '加购优惠',
  112: '优惠券',
  123: '店铺闪购',
  113: '关注有礼',
  100: '热门精选',
  101: '店铺分类',
  102: '退货退款',
  103: '账户健康',
  117: '广告',
  104: '公共',
  105: '消息推送',
  124: '官方仓与库存',
  126: '官方履约（巴西）',
  125: '直播',
  139: '品牌门户',
};

// Overview（指南总览）条目中文名（条目 id → 中文）
const ZH_OVERVIEW_ITEM = {
  64: '介绍',
  58: 'OpenAPI 2.0 概览',
  65: 'OpenAPI 2.0 概览（中文版）',
  69: 'CNSC API 对接用户手册',
  74: 'KRSC API 集成指南',
  59: '开发者指南',
  60: 'API 调用流程',
  61: '开发者类型与应用类型',
  62: '数据定义',
  63: '消息推送机制（WebHook）',
};

// 开发者指南分类中文名（分类 id → 中文）
const ZH_GUIDE_CATEGORY = {
  50: '快速入门',
  2126: '巴西｜开发者之旅',
  2058: 'API 指引与流程',
  54: '服务条款',
  2125: '从这里开始',
  2067: '巴西｜本地专属指引',
};

// 开发者指南文章补充翻译（仅用于官方没有中文名的条目，文章 id → 中文）
const ZH_GUIDE_OVERRIDE = {
  // Getting Started
  24: '服务商合作计划',
  27: 'V2.0 API 调用流程',
  29: 'KRSC API 集成指南',
  31: 'V2.0 数据定义',
  732: '台湾新开发者审核',
  // 巴西开发者之旅（原文为葡萄牙语）
  736: '开发一个集成',
  384: '创建登录账号',
  738: '创建开发者账号',
  740: '创建你的 App',
  744: '进行测试（沙箱）',
  741: '发布你的 App（上线）',
  739: '授权你的第一家店铺',
  743: '敏感数据',
  745: '发起你的第一次 API 调用',
  746: '消息推送（Webhooks）',
  735: '常见问题',
  737: '参考资料',
  747: '提交工单前的注意事项',
  // 巴西｜本地专属指引
  383: '订单类 API',
  292: '物流类 API',
  382: '通过 OpenAPI 上传 NF-e（巴西电子发票）与数据脱敏',
  378: '汽车配件：配件兼容性',
  290: 'Shopee 直达配送',
  568: 'Shopee 官方履约（巴西）',
  286: '卖家物流（报价 API）',
  697: '报价 API（极速达）开发者指南',
  381: '开放平台日志工具',
  // API 指引与流程
  643: '即时零售对接指南',
  // 服务条款
  646: '台湾开发者审查',
  723: 'Chatbot 服务条款',
  // 散篇
  742: '申报你的 IP（白名单）',
};

/* ================= 网络 ================= */

function fetchJson(url, referer) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.get(
      {
        hostname: u.hostname,
        path: u.pathname + u.search,
        headers: { 'User-Agent': UA, Referer: referer || u.origin, Accept: 'application/json' },
      },
      (res) => {
        let buf = '';
        res.setEncoding('utf8');
        res.on('data', (d) => (buf += d));
        res.on('end', () => {
          try {
            resolve(JSON.parse(buf));
          } catch (e) {
            reject(new Error('JSON 解析失败: ' + url + '\n' + buf.slice(0, 300)));
          }
        });
      }
    );
    req.on('error', reject);
    req.setTimeout(40000, () => req.destroy(new Error('请求超时: ' + url)));
  });
}

/** 抓一次，失败等 800ms 再抓一次（官方详情接口偶发超时/抖动） */
async function fetchJsonRetry(url, referer) {
  try {
    return await fetchJson(url, referer);
  } catch (e) {
    await new Promise((r) => setTimeout(r, 800));
    return fetchJson(url, referer);
  }
}

/** 并发受限的 map（保持零依赖） */
async function mapLimit(items, limit, fn) {
  let cursor = 0;
  const n = Math.max(1, Math.min(limit, items.length));
  const worker = async () => {
    while (cursor < items.length) {
      const i = cursor++;
      await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: n }, worker));
}

function saveJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
  console.log('[raw] ' + path.relative(ROOT, file));
}

/* ================= 开发者指南目录（中文） ================= */

function collectZhNames(list) {
  const map = {};
  (function walk(items) {
    for (const it of items || []) {
      if (it.item_name) map[it.item_id] = it.item_name;
      if (Array.isArray(it.children)) walk(it.children);
    }
  })(list.developer_guide_list || []);
  return map;
}

function guideZhName(item, officialZhMap) {
  const cn = officialZhMap[item.item_id];
  if (cn && cn !== item.item_name) return { name: cn, extra: false }; // 官方中文名
  if (ZH_GUIDE_OVERRIDE[item.item_id]) return { name: ZH_GUIDE_OVERRIDE[item.item_id], extra: true }; // 本目录补充翻译
  return { name: item.item_name, extra: false }; // 兜底：保留原文
}

function renderGuideListZh(enList, cnList, fetchedDate) {
  const officialZh = collectZhNames(cnList);
  const out = [];
  out.push('# Shopee Open Platform 开发者指南目录（中文版）');
  out.push('');
  out.push('> 数据来源：`/developer_guide/list`（en / zh-Hans），抓取于 ' + fetchedDate + '。');
  out.push('> 官方页面：国际站 <https://open.shopee.com/developer-guide> ｜ 中国站 <https://open.shopee.cn/developer-guide>');
  out.push('');
  out.push('说明：');
  out.push('');
  out.push('- 中文标题优先采用官方中文名；官方未提供中文名的条目由本目录补充翻译并标注 †。');
  out.push('- 「编号」即文章 document_id，官方页面按规律拼接：国际站 `https://open.shopee.com/developer-guide/{编号}`、中国站 `https://open.shopee.cn/developer-guide/{编号}`。');
  out.push('');

  // 目录（分类总览）
  const list = enList.developer_guide_list || [];
  const toc = [];
  const countArticles = (items) => {
    let n = 0;
    for (const it of items || []) {
      if (it.item_type === 2) n += 1;
      if (Array.isArray(it.children)) n += countArticles(it.children);
    }
    return n;
  };
  out.push('## 目录');
  out.push('');
  let topStrays = [];
  for (const cat of list) {
    if (cat.item_type === 1) {
      const zh = ZH_GUIDE_CATEGORY[cat.item_id] || cat.item_name;
      toc.push(`[${zh}（${cat.item_name}）](#${slugAnchor(zh + '（' + cat.item_name + '）')})（${countArticles(cat.children || [])} 篇）`);
    } else {
      topStrays.push(cat);
    }
  }
  if (topStrays.length) toc.push(`[散篇](#${slugAnchor('散篇')})（${topStrays.length} 篇）`);
  for (const t of toc) out.push('- ' + t);
  out.push('');

  // 文章表格（紧凑：不逐条贴链接，链接按编号拼接）
  const articleTable = (items) => {
    out.push('| 中文标题 | 原文标题 | 编号 |');
    out.push('|---|---|---|');
    for (const it of items) {
      const zh = guideZhName(it, officialZh);
      const mark = zh.extra ? ' †' : '';
      const enName = it.item_name === zh.name ? '—' : it.item_name;
      out.push('| ' + zh.name + mark + ' | ' + enName + ' | ' + it.item_id + ' |');
    }
    out.push('');
  };

  const renderSection = (items, level) => {
    const articles = (items || []).filter((c) => c.item_type === 2);
    const subcats = (items || []).filter((c) => c.item_type === 1);
    if (articles.length) articleTable(articles);
    for (const sub of subcats) {
      const zh = ZH_GUIDE_CATEGORY[sub.item_id] || sub.item_name;
      out.push('#'.repeat(level) + ' ' + zh + '（' + sub.item_name + '）');
      out.push('');
      renderSection(sub.children || [], level + 1);
    }
  };

  for (const cat of list) {
    if (cat.item_type === 1) {
      const zh = ZH_GUIDE_CATEGORY[cat.item_id] || cat.item_name;
      out.push('## ' + zh + '（' + cat.item_name + '）');
      out.push('');
      renderSection(cat.children || [], 3);
    }
  }
  if (topStrays.length) {
    out.push('## 散篇');
    out.push('');
    articleTable(topStrays);
  }

  out.push('---');
  out.push('');
  out.push('† 标注为本目录补充翻译（官方暂无中文标题），仅供参考，以官方页面为准。');
  out.push('');
  return out.join('\n');
}

// 生成 GitHub 风格锚点（对标 GitHub 的 heading 锚点算法：去标点、空格转横线、小写）
function slugAnchor(s) {
  return String(s)
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .trim()
    .replace(/\s+/g, '-')
    .toLowerCase();
}

/* ================= API 参考目录（中文） ================= */

function renderApiCatalogZh(tree, fetchedDate) {
  const out = [];
  out.push('# Shopee Open Platform API 参考目录（v2，中文版）');
  out.push('');
  const totalItems = tree.modules.reduce((s, m) => s + (m.items || []).length, 0);
  out.push('> 数据来源：`/doc/module?version=2`，抓取于 ' + fetchedDate + '，共 ' + tree.modules.length + ' 个模块、' + totalItems + ' 个条目。');
  out.push('> 官方页面：<https://open.shopee.cn/documents>');
  out.push('');
  out.push('说明：');
  out.push('');
  out.push('- 接口名保持官方标识符（如 `v2.ams.get_open_campaign_added_product`）不变，仅模块名给出中文译名。');
  out.push('- 接口官方页面按规律拼接（中国站）：`https://open.shopee.cn/documents/v2/{api_name}?module={模块ID}&type=1`，模块 ID 见「模块总览」。');
  out.push('- 「指南总览」模块下为文档指南页（非 API），官方跳转按规律拼接：`https://open.shopee.com/developer-guide?from=doc&id={条目编号}`。');
  out.push('- 单个接口的「方法 / 必填参数 / 分页键 / 错误码」见 `_raw/api_meta_v2.json`（由本脚本随目录一并生成）。');
  out.push('');

  // 模块总览
  out.push('## 模块总览');
  out.push('');
  out.push('| 模块 | 中文名称 | 模块 ID | 条目数 |');
  out.push('|---|---|---|---|');
  for (const mod of tree.modules) {
    const zh = ZH_MODULE[mod.module_id] || mod.module_name;
    out.push('| [`' + mod.module_name + '`](#' + slugAnchor(zh + '（' + mod.module_name + '）') + ') | ' + zh + ' | ' + mod.module_id + ' | ' + (mod.items || []).length + ' |');
  }
  out.push('');

  // 各模块明细（紧凑：只列条目名，链接按规律拼接）
  for (const mod of tree.modules) {
    const zh = ZH_MODULE[mod.module_id] || mod.module_name;
    out.push('## ' + zh + '（' + mod.module_name + '）');
    out.push('');
    for (const it of mod.items || []) {
      if (mod.type === 1) {
        out.push('- `' + it.name + '`');
      } else {
        const zhName = ZH_OVERVIEW_ITEM[it.id] || it.name;
        out.push('- ' + zhName + '（' + it.name + '，编号 ' + it.id + '）');
      }
    }
    out.push('');
  }
  return out.join('\n');
}

/* ================= 接口元数据（api_meta_v2.json） ================= */

/** 取响应结构里 `response` 层的字段（分页键 / 列表键都从这里看） */
function responseChildren(parsed) {
  const rp = (parsed && parsed.response_params) || [];
  const r = rp.find((x) => x && x.name === 'response');
  return r && Array.isArray(r.children) ? r.children : [];
}

/** 把官方详情响应提炼成调用所需的元数据 */
function distillApiMeta(detail) {
  const apiName = String(detail.api_name || '');
  // 方法：method 字段为权威（1=POST 写 / 2=GET 读）；缺失时回退解析请求示例里的 HTTP 动词
  let method = '';
  if (detail.method === 2) method = 'GET';
  else if (detail.method === 1) method = 'POST';
  if (!method) {
    const rs = String(detail.request_sample || '');
    const m = rs.match(/CUSTOMREQUEST = '(\w+)'/) || rs.match(/--request (\w+)/);
    if (m) method = m[1].toUpperCase();
  }

  let parsed = {};
  try {
    parsed = JSON.parse(detail.params || '{}') || {};
  } catch (e) {
    parsed = {};
  }
  const request = (parsed.request_params || [])
    .map((p) => ({
      name: String(p.name || ''),
      type: String(p.type || ''),
      required: p.required === 'True' || p.required === true,
      sample: p.sample === undefined || p.sample === null ? '' : String(p.sample),
      description: String(p.description || '').replace(/<[^>]*>/g, '').slice(0, 300),
    }))
    .filter((p) => p.name);

  const children = responseChildren(parsed);
  const listKeys = children.filter((c) => /\[\]$/.test(String(c.type || ''))).map((c) => String(c.name));
  const names = new Set(children.map((c) => String(c.name)));
  const keys = [];
  for (const k of ['more', 'next_cursor', 'next_offset', 'page_no', 'total_count', 'has_next_page']) {
    if (names.has(k)) keys.push(k);
  }
  let style = '';
  if (names.has('next_cursor')) style = 'cursor';
  else if (names.has('next_offset')) style = 'offset';
  else if (names.has('more') || names.has('page_no') || names.has('total_count')) style = 'page';

  const errors = Array.from(new Set((detail.error_list || []).map((e) => String((e && e.name) || '')).filter(Boolean))).slice(0, 40);

  return {
    apiName,
    method,
    rateLimit: String(detail.rate_limit || ''),
    request,
    paging: { style, keys, listKeys },
    errors,
  };
}

/** 抓取全部 v2 接口详情并落盘 api_meta_v2.json（失败的接口跳过，不影响其它） */
async function fetchApiMeta(moduleTree) {
  const items = [];
  for (const m of moduleTree.modules || []) {
    for (const it of m.items || []) {
      if (it.type !== 1) continue;
      if (!String(it.name || '').startsWith('v2.')) continue;
      items.push({ id: it.id, name: String(it.name) });
    }
  }
  const apis = {};
  const failed = [];
  let done = 0;
  await mapLimit(items, API_META_CONCURRENCY, async (it) => {
    try {
      const d = await fetchJsonRetry(DOC_API_DETAIL + it.id + '&version=2', CN);
      const dm = distillApiMeta(d);
      if (!dm.apiName) dm.apiName = it.name;
      apis[dm.apiName] = dm;
    } catch (e) {
      failed.push(it.name);
    }
    done++;
    if (done % 50 === 0) console.log(`[meta] ${done}/${items.length}`);
  });

  const out = {
    generatedAt: new Date().toISOString().slice(0, 10),
    source: DOC_API_DETAIL + '<api_id>&version=2',
    total: items.length,
    count: Object.keys(apis).length,
    apis,
  };
  saveJson(API_META_FILE, out);
  if (failed.length) {
    console.warn(`[meta] ${failed.length}/${items.length} 个接口详情抓取失败（其余已写入）：` + failed.slice(0, 10).join(', '));
  }
  return out;
}

/* ================= 主流程 ================= */

async function main() {
  fs.mkdirSync(RAW_DIR, { recursive: true });
  const local = process.argv.includes('--local');
  const noMeta = process.argv.includes('--no-meta');
  const metaOnly = process.argv.includes('--meta-only');

  // 只刷新接口元数据：读现有模块树快照，不改动目录与其它快照
  if (metaOnly) {
    const tree = JSON.parse(fs.readFileSync(path.join(RAW_DIR, 'doc_module_v2.json'), 'utf8'));
    console.log('[meta] 仅抓取接口元数据（不改动其它快照 / 目录）');
    await fetchApiMeta(tree);
    console.log('完成。');
    return;
  }

  let guideListEn, guideListCn, moduleTree, fetchedDate;
  if (local) {
    // 离线模式：直接用 _raw/ 快照重渲染（改格式后刷新目录，不访问网络）
    guideListEn = JSON.parse(fs.readFileSync(path.join(RAW_DIR, 'guide_list_en.json'), 'utf8'));
    guideListCn = JSON.parse(fs.readFileSync(path.join(RAW_DIR, 'guide_list_cn.json'), 'utf8'));
    moduleTree = JSON.parse(fs.readFileSync(path.join(RAW_DIR, 'doc_module_v2.json'), 'utf8'));
    fetchedDate = fs.statSync(path.join(RAW_DIR, 'guide_list_en.json')).mtime.toISOString().slice(0, 10);
    console.log('[local] 使用 _raw/ 快照重渲染（快照抓取于 ' + fetchedDate + '）');
  } else {
    fetchedDate = new Date().toISOString().slice(0, 10);
    // 1) 开发者指南目录（中英）
    guideListEn = await fetchJson(SG + '/opservice/api/v1/developer_guide/list?language_code=en', SG);
    guideListCn = await fetchJson(CN + '/opservice/api/v1/developer_guide/list?language_code=zh-Hans', CN);
    saveJson(path.join(RAW_DIR, 'guide_list_en.json'), guideListEn);
    saveJson(path.join(RAW_DIR, 'guide_list_cn.json'), guideListCn);

    // 2) API 模块树（v2）
    moduleTree = await fetchJson(DOC_MODULE_API, CN);
    saveJson(path.join(RAW_DIR, 'doc_module_v2.json'), moduleTree);
  }

  // 3) 渲染两份中文目录
  const guideDir = path.join(ROOT, 'developer-guide');
  fs.mkdirSync(guideDir, { recursive: true });
  fs.writeFileSync(path.join(guideDir, 'README.md'), renderGuideListZh(guideListEn, guideListCn, fetchedDate), 'utf8');
  console.log('[doc] developer-guide/README.md');

  const apiDir = path.join(ROOT, 'api');
  fs.mkdirSync(apiDir, { recursive: true });
  fs.writeFileSync(path.join(apiDir, 'README.md'), renderApiCatalogZh(moduleTree, fetchedDate), 'utf8');
  console.log('[doc] api/README.md');

  // 4) 接口元数据（需联网；--local / --no-meta 时跳过，保留已有快照）
  if (!local && !noMeta) {
    await fetchApiMeta(moduleTree);
  } else {
    console.log('[meta] 跳过接口元数据抓取（' + (local ? '--local' : '--no-meta') + '）');
  }

  console.log('完成。');
}

main().catch((e) => {
  console.error('[失败]', e && e.message ? e.message : e);
  process.exit(1);
});
