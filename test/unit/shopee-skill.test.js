'use strict';
// 单元测试：shopee_skill 数据查询 CLI
// 覆盖：参数解析（args）/ 接口目录与元数据（catalog）/ 时间窗换算（time）/
//       输出取值（output）/ 自动翻页（paging，用 require.cache 注入假 callOpenApi）。
// 全部离线：不打网关、不需凭证；paging 用例不加载真实 openapi client（避免读用户 session）。
const fs = require('fs');
const path = require('path');
const { t } = require('../helpers');
const { parse, bool, intOf } = require('../../shopee_skill/lib/args');
const catalog = require('../../shopee_skill/lib/catalog');
const { extractPayload, selectPath } = require('../../shopee_skill/lib/output');
const { parseDuration, parseTimePoint, applyHelpers } = require('../../shopee_skill/lib/time');

const META_FILE = path.join(__dirname, '..', '..', 'docs', 'shopee_api_doc', '_raw', 'api_meta_v2.json');

/** 用假 callOpenApi 加载 paging.js；用完还原 require.cache，避免污染其它用例 */
function loadPagingWith(fakeCall) {
  const clientPath = require.resolve('../../server/openapi/client');
  const pagingPath = require.resolve('../../shopee_skill/lib/paging');
  const prevClient = require.cache[clientPath];
  const prevPaging = require.cache[pagingPath];
  require.cache[clientPath] = { id: clientPath, filename: clientPath, loaded: true, exports: { callOpenApi: fakeCall } };
  delete require.cache[pagingPath];
  const mod = require(pagingPath);
  if (prevClient) require.cache[clientPath] = prevClient; else delete require.cache[clientPath];
  if (prevPaging) require.cache[pagingPath] = prevPaging; else delete require.cache[pagingPath];
  return mod;
}

async function run() {
  // ===== 参数解析 =====
  {
    const r = parse(['call', 'v2.product.get_item_list', '--shop', '123', '--param', 'a=1', '--param', 'b=2', '--all', '--k=v']);
    t('args 位置参数进 _', r._.join('|') === 'call|v2.product.get_item_list', r._.join('|'));
    t('args --k v 取值', r.flags.shop === '123');
    t('args --k=v 取值', r.flags.k === 'v');
    t('args --flag 无值判 true', r.flags.all === true);
    t('args --param 可重复收集为数组', Array.isArray(r.flags.param) && r.flags.param.join(',') === 'a=1,b=2');

    const after = parse(['call', 'x', '--', '--not-a-flag', 'z']);
    t('args -- 之后一律当位置参数', after._.join('|') === 'call|x|--not-a-flag|z', after._.join('|'));
    t('args 值以 -- 开头时不吞下一个 flag',
      parse(['call', 'x', '--raw', '--shop', '1']).flags.raw === true);

    t('args bool 识别 true/1/yes', bool(true) && bool('true') && bool('1') && bool('yes') && !bool('0') && !bool(undefined));
    t('args intOf 非法回退默认', intOf('abc', 10) === 10 && intOf('5', 10) === 5 && intOf(undefined, 7) === 7);
  }

  // ===== 接口目录与方法判定 =====
  {
    t('inferMethod 查询动词 -> GET', catalog.inferMethod('v2.product.get_item_list') === 'GET');
    t('inferMethod 其余 -> POST', catalog.inferMethod('v2.discount.add_discount') === 'POST');

    t('normalizeApi 官方名', catalog.normalizeApi('v2.product.get_item_list').apiPath === '/api/v2/product/get_item_list');
    t('normalizeApi 完整路径', catalog.normalizeApi('/api/v2/product/get_item_list').apiName === 'v2.product.get_item_list');
    t('normalizeApi 简写补 v2 前缀', catalog.normalizeApi('product.get_item_list').apiName === 'v2.product.get_item_list');
    t('apiNameOf 路径转接口名', catalog.apiNameOf('/api/v2/order/get_order_list') === 'v2.order.get_order_list');

    const rows = catalog.listApis({ keyword: 'order' });
    t('listApis 关键词命中接口名', rows.some((a) => a.apiName === 'v2.order.get_order_list'));
    t('listApis 默认只列查询类', rows.every((a) => a.read === true));
    const withWrites = catalog.listApis({ keyword: 'add_discount', writes: true });
    t('listApis --writes 能列出写操作', withWrites.some((a) => a.apiName === 'v2.discount.add_discount' && a.read === false));
    t('listApis 关键词可匹配模块英文名', catalog.listApis({ keyword: 'discount', writes: true }).length > 0);

    const d = catalog.describe('v2.discount.add_discount');
    t('describe 未收录标记 inCatalog', d.inCatalog === true);
    t('describe 方法来源为元数据', d.methodSource === 'metadata' && d.method === 'POST' && d.read === false);
    t('describe 给出必填参数', Array.isArray(d.required) && d.required.includes('discount_name'));
    const custom = catalog.describe('v2.foo.bar');
    t('describe 未收录接口仍给推断方法', custom.inCatalog === false && custom.method === 'POST' && custom.methodSource === 'name');
  }

  // ===== 接口元数据（api_meta_v2.json）=====
  {
    const info = catalog.metaInfo();
    t('元数据文件可用', info.available === true && info.count > 400, JSON.stringify(info));
    t('目录文件存在（用于元数据/目录断言）', fs.existsSync(META_FILE));

    // 动词启发式会误判 batch_get_* 为写操作；元数据必须纠正为 GET
    const mo = catalog.methodOf('v2.ams.batch_get_products_suggested_rate');
    t('元数据纠正 batch_get_* 为 GET（动词推断会误判）',
      mo.method === 'GET' && mo.source === 'metadata', JSON.stringify(mo));
    t('必填参数解析', catalog.requiredParams('v2.discount.add_discount').includes('end_time'));
    t('已知参数解析', catalog.knownParams('v2.order.get_order_list').includes('time_from'));

    const ord = catalog.metaOf('v2.order.get_order_list');
    t('元数据带分页键与列表键',
      ord && ord.paging.style === 'cursor' && ord.paging.listKeys.includes('order_list'),
      JSON.stringify(ord && ord.paging));
  }

  // ===== 时间窗换算 =====
  {
    t('parseDuration 单位换算', parseDuration('7d') === 604800 && parseDuration('24h') === 86400
      && parseDuration('30m') === 1800 && parseDuration('90') === 90);
    t('parseDuration 非法返回 null', parseDuration('abc') === null && parseDuration('') === null);

    t('parseTimePoint epoch 秒', parseTimePoint('1700000000', 0) === 1700000000);
    t('parseTimePoint 13 位毫秒', parseTimePoint('1800000000000', 0) === 1800000000);
    t('parseTimePoint 相对 -7d', parseTimePoint('-7d', 1800000000) === 1800000000 - 604800);
    t('parseTimePoint ISO 日期', parseTimePoint('2024-01-02', 0) === 1704153600);
    t('parseTimePoint 非法返回 null', parseTimePoint('bad', 0) === null);

    const known = ['time_from', 'time_to', 'time_range_field', 'page_size'];
    const a = applyHelpers({}, { last: '7d' }, known, 1800000000);
    t('applyHelpers --last 补 time_from/time_to/time_range_field',
      a.params.time_from === 1800000000 - 604800 && a.params.time_to === 1800000000
      && a.params.time_range_field === 'create_time' && a.notes.length === 0, JSON.stringify(a));
    const b = applyHelpers({}, { 'page-size': '50' }, known, 1800000000);
    t('applyHelpers --page-size 注入 page_size', b.params.page_size === 50);
    const c = applyHelpers({ time_from: 1 }, { last: '7d' }, known, 1800000000);
    t('applyHelpers 不覆盖用户已给的 time_from', c.params.time_from === 1 && c.params.time_to === 1800000000);
    const e = applyHelpers({}, { last: '7d' }, ['page_size'], 1800000000);
    t('applyHelpers 参数表不含该字段时跳过并记提示',
      e.params.time_from === undefined && e.notes.some((n) => n.includes('time_from')), JSON.stringify(e));
  }

  // ===== 输出取值 =====
  {
    t('extractPayload 优先 response',
      JSON.stringify(extractPayload({ response: { a: 1 }, data: { b: 2 } })) === '{"a":1}');
    t('extractPayload 回落 data',
      JSON.stringify(extractPayload({ response: {}, data: { b: 2 } })) === '{"b":2}');
    t('extractPayload 无载荷层时原样返回',
      JSON.stringify(extractPayload({ x: 1 })) === '{"x":1}');

    t('selectPath 点分取值', selectPath({ a: { b: { c: 3 } } }, 'a.b.c') === 3);
    t('selectPath 支持数组下标', selectPath({ a: [{ b: 1 }, { b: 2 }] }, 'a.1.b') === 2);
    t('selectPath 空路径返回原值', JSON.stringify(selectPath({ a: 1 }, '')) === '{"a":1}');
    t('selectPath 取不到返回 undefined', selectPath({ a: 1 }, 'a.b') === undefined && selectPath({ a: 1 }, 'z') === undefined);
  }

  // ===== 自动翻页（注入假 callOpenApi）=====
  {
    const { detectStyle, detectListKey, stillMore } = loadPagingWith(async () => ({ response: {} }));
    t('detectStyle 元数据优先', detectStyle({ next_offset: 1 }, { paging: { style: 'cursor' } }) === 'cursor');
    t('detectStyle 无元数据时按响应键推断',
      detectStyle({ next_cursor: 'c' }, null) === 'cursor' && detectStyle({ next_offset: 1 }, null) === 'offset'
      && detectStyle({ more: true }, null) === 'page' && detectStyle({}, null) === '');
    t('detectListKey 元数据优先且回退首数组',
      detectListKey({ b: [] }, { paging: { listKeys: ['a'] } }) === 'a'
      && detectListKey({ b: [] }, null) === 'b');
    t('stillMore 缺 more 时按风格判定',
      stillMore({ next_cursor: 'c' }, 'cursor', 0, 0) === true
      && stillMore({ next_cursor: '' }, 'cursor', 0, 0) === false
      && stillMore({}, 'page', 10, 10) === true && stillMore({}, 'page', 10, 3) === false);
  }

  {
    const meta = { paging: { style: 'offset', keys: ['more', 'next_offset'], listKeys: ['items'] } };
    let calls = 0;
    const fake = async (apiPath, params) => {
      calls++;
      const all = [1, 2, 3, 4, 5];
      const off = Number(params.offset || 0);
      const slice = all.slice(off, off + 2);
      const nextOff = off + slice.length;
      return { response: { items: slice, more: nextOff < all.length, next_offset: nextOff } };
    };
    const { callWithPaging } = loadPagingWith(fake);

    calls = 0;
    const r1 = await callWithPaging({ apiPath: '/x', business: {}, shopId: '1', method: 'GET', all: true, maxPages: 10, meta });
    t('翻页 offset 风格拼接全部页',
      r1.response.items.join(',') === '1,2,3,4,5' && r1.response.pages === 3 && calls === 3, JSON.stringify(r1.response));
    t('翻页完成不残留翻页字段（more=false / next_offset=null / truncated=false）',
      r1.response.more === false && r1.response.next_offset === null && r1.response.truncated === false);

    const r2 = await callWithPaging({ apiPath: '/x', business: { page_size: 2 }, shopId: '1', method: 'GET', all: true, maxPages: 1, meta });
    t('达页数上限时标记 truncated 并保留游标',
      r2.response.pages === 1 && r2.response.truncated === true && r2.response.more === true
      && r2.response.next_offset === 2, JSON.stringify(r2.response));

    const r3 = await callWithPaging({ apiPath: '/x', business: {}, shopId: '1', method: 'GET', all: true, maxPages: 0, meta });
    t('--max-pages 0 表示不翻页（只要首屏）',
      r3.response.items.join(',') === '1,2' && r3.response.pages === undefined);

    const r4 = await callWithPaging({ apiPath: '/x', business: {}, shopId: '1', method: 'GET', all: false, maxPages: 10, meta });
    t('未加 --all 时只调一次', r4.response.pages === undefined);
  }

  {
    const meta = { paging: { style: 'cursor', keys: ['more', 'next_cursor'], listKeys: ['order_list'] } };
    const fake = async (apiPath, params) => {
      const c = params.cursor || '';
      if (c === '') return { response: { order_list: [1, 2], more: true, next_cursor: 'c1' } };
      return { response: { order_list: [3], more: false, next_cursor: '' } };
    };
    const { callWithPaging } = loadPagingWith(fake);
    const r = await callWithPaging({ apiPath: '/x', business: {}, shopId: '1', method: 'GET', all: true, maxPages: 10, meta });
    t('翻页 cursor 风格拼接并清空 next_cursor',
      r.response.order_list.join(',') === '1,2,3' && r.response.pages === 2 && r.response.next_cursor === '',
      JSON.stringify(r.response));
  }

  {
    // 无分页语义的接口：--all 也只返回首屏，不报错
    const fake = async () => ({ response: { rates: [1] } });
    const { callWithPaging } = loadPagingWith(fake);
    const r = await callWithPaging({ apiPath: '/x', business: {}, shopId: '1', method: 'GET', all: true, maxPages: 10, meta: null });
    t('无翻页语义时不翻页、不报错', r.response.rates.join(',') === '1' && r.response.pages === undefined);
  }
}

module.exports = { run };
