'use strict';
// 单元测试：后端纯函数（无网络依赖、不启动服务）。
// 覆盖：视频上传工具（哈希/etag/AES 解密/auth 解析/SigV4/item 收集/MP4 探测/行校验）、
//       TikTok 链接处理与错误分类、竞价金额换算、开放平台签名/打码/redirect 校验。
const os = require('os');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { t } = require('./helpers');
const {
  md5hex,
  etagOf,
  etagFromSha1Hex,
  streamHashes,
  decryptVodToken,
  awsSigV4,
  authExpOf,
  findItemIds,
  probeVideo,
  probeVideoFile,
  validateUploadRow,
} = require('../server/lib/video-utils');
const video = require('../server/video');
const {
  extractUrls,
  extractVideoIdFromUrl,
  isNetworkError,
} = require('../server/tiktok/parse');
const { detectProxy, createAgent } = require('../server/tiktok/proxy');
const { toAmount } = require('../server/bidding');
const biddingCancel = require('../server/bidding-cancel');
const hotlistingCancel = require('../server/hotlisting-cancel');
const {
  imageUrlOf, statusNameOf, firstStr, productsOf, totalOf: peTotalOf, tiersOf, optionsOf, optionTextOf,
  optionImageIdOf, tierTableOf, buildRows, rowToCells, headerCells,
} = require('../server/product-export');
const { nowSec, buildBaseString, hmacHex, maskToken } = require('../server/lib/openapi-utils');
const { parseJsonText } = require('../server/lib/http-utils');
const {
  buildShopeeUrl, DEFAULT_REGION, HOST,
} = require('../server/lib/shopee-session');
const { timestampText, ensureDir, defaultOutDir } = require('../server/lib/export-utils');
const openapi = require('../server/openapi');
const { isAuthDead, isAuthRetryable, planRefresh } = require('../server/openapi/client');
const { createDispatcher } = require('../server/lib/http-utils');

// ---------- 监控模块：数据目录隔离到临时目录（不碰 server/data） ----------
const MONITOR_TMP = path.join(os.tmpdir(), `kp_monitor_test_${process.pid}_${Date.now()}`);
process.env.MONITOR_DATA_DIR = MONITOR_TMP;
const {
  evaluateRule, isMoreSevere, mergeRules, levelOf,
} = require('../server/monitor/rules');
const {
  listOf, orderAgeBuckets, stockOfModel, stockSummary, itemStockState, normalizeHealth,
  totalOf, orderSnDate, formatDdMmYyyy, normalizeAdsHourly, normalizeBalance, normalizePunishments,
  violationBreakdown, walletSummary, returnSummary, commentSummary, isPermissionDenied,
} = require('../server/monitor/collectors');
const monitorStore = require('../server/monitor/store');
const monitorEngine = require('../server/monitor/engine');
const currency = require('../server/monitor/currency');

// ---------- 合成一个可被 probeVideo 解析的 MP4（仅盒结构，无真实媒体数据） ----------
function box(type, payload) {
  const b = Buffer.alloc(8 + payload.length);
  b.writeUInt32BE(b.length, 0);
  b.write(type, 4, 'latin1');
  payload.copy(b, 8);
  return b;
}
function mvhdBody(timescale, duration) {
  const b = Buffer.alloc(20);
  b.writeUInt32BE(0, 0); // version=0 + flags
  b.writeUInt32BE(timescale, 12);
  b.writeUInt32BE(duration, 16);
  return b;
}
function tkhdBody(width, height) {
  const b = Buffer.alloc(84); // version=0 的 tkhd 中 width 在 body 偏移 76，height 在 80
  b.writeUInt32BE(0, 0);
  b.writeUInt32BE(1, 12); // track id
  b.writeUInt32BE(width * 65536, 76);
  b.writeUInt32BE(height * 65536, 80);
  return b;
}
function buildMp4() {
  const mvhd = box('mvhd', mvhdBody(1000, 5000));
  const tkhd = box('tkhd', tkhdBody(1920, 1080));
  const trak = box('trak', tkhd);
  const moov = box('moov', Buffer.concat([mvhd, trak]));
  return Buffer.concat([box('ftyp', Buffer.from('isom')), moov]);
}

// ---------- 构造 Authorization（base64("50007225:<jwt>")） ----------
function b64url(str) {
  return Buffer.from(str, 'utf8').toString('base64url');
}
function makeAuth(exp) {
  const jwt = `${b64url('{"alg":"HS256"}')}.${b64url(JSON.stringify({ exp }))}.sig`;
  return Buffer.from('50007225:' + jwt).toString('base64');
}

async function run() {
  // ===== 哈希 / etag =====
  t('md5hex 空串为已知值', md5hex(Buffer.alloc(0)) === 'd41d8cd98f00b204e9800998ecf8427e');
  t('md5hex 与 crypto 标准实现一致', md5hex(Buffer.from('hello')) === crypto.createHash('md5').update('hello').digest('hex'));
  {
    const buf = Buffer.from('test-etag');
    const expect = Buffer.concat([Buffer.from([0x16]), crypto.createHash('sha1').update(buf).digest()]).toString('base64url');
    t('etagOf 拼接 0x16 + sha1 并 base64url', etagOf(buf) === expect);
    t('etagOf 确定性', etagOf(buf) === etagOf(buf));
    t('etagFromSha1Hex 与 etagOf 一致', etagFromSha1Hex(crypto.createHash('sha1').update(buf).digest('hex')) === etagOf(buf));
  }

  // ===== streamHashes（流式哈希，不整文件加载） =====
  {
    const tmp = path.join(os.tmpdir(), `kp_hash_${Date.now()}.dat`);
    const content = Buffer.from('stream-hash-test-content-流式哈希测试');
    fs.writeFileSync(tmp, content);
    try {
      const h = await streamHashes(tmp);
      t('streamHashes 返回正确 size', h.size === content.length, `size=${h.size}`);
      t('streamHashes md5 与一次性计算一致', h.md5 === crypto.createHash('md5').update(content).digest('hex'));
      t('streamHashes sha1 与一次性计算一致', h.sha1 === crypto.createHash('sha1').update(content).digest('hex'));
      t('streamHashes sha256 与一次性计算一致', h.sha256 === crypto.createHash('sha256').update(content).digest('hex'));
    } finally {
      fs.unlinkSync(tmp);
    }
  }

  // ===== decryptVodToken =====
  {
    const plain = 'NTAwMDcyMjU6eyJ0eXAiOiJKV1QifQ';
    const key = Buffer.from('shopee_vod_' + String(178).padStart(5, '0'));
    const iv = Buffer.from('1234567887654321');
    const enc = crypto.createCipheriv('aes-128-cbc', key, iv);
    const token = Buffer.concat([enc.update(Buffer.from(plain, 'utf8')), enc.final()]).toString('base64');
    t('decryptVodToken 可解密按 SDK 规则加密的凭证', decryptVodToken(token, 178) === plain);
    t('decryptVodToken 解密失败返回原值兜底', decryptVodToken('!!!invalid!!!', 178) === '!!!invalid!!!');
  }

  // ===== authExpOf =====
  t('authExpOf 解析 JWT exp', authExpOf(makeAuth(1750000000)) === 1750000000);
  t('authExpOf 非法输入返回 0', authExpOf('garbage') === 0);
  t('authExpOf 空串返回 0', authExpOf('') === 0);

  // ===== awsSigV4 =====
  {
    const o = {
      method: 'PUT',
      host: 'up.example.com',
      path: '/mms/vid1.mp4',
      query: { 'x-id': 'PutObject' },
      headers: { 'Content-Type': 'video/mp4' },
      extraHeaders: { 'x-amz-meta-mms-mediaid': 'vid1' },
      body: Buffer.from('data'),
      accessKey: 'ak',
      secretKey: 'sk',
      sessionToken: '',
      region: 'PH',
      service: 's3',
    };
    const s1 = awsSigV4(o);
    const s2 = awsSigV4(o);
    t('awsSigV4 返回全部签名头', ['Authorization', 'x-amz-date', 'x-amz-security-token', 'x-amz-content-sha256'].every((k) => k in s1));
    t('awsSigV4 Authorization 格式正确', s1.Authorization.startsWith('AWS4-HMAC-SHA256 Credential=ak/') && s1.Authorization.includes('/PH/s3/aws4_request, SignedHeaders='));
    t('awsSigV4 content-sha256 与请求体哈希一致', s1['x-amz-content-sha256'] === crypto.createHash('sha256').update('data').digest('hex'));
    t('awsSigV4 日期为 YYYYMMDDTHHMMSSZ', /^\d{8}T\d{6}Z$/.test(s1['x-amz-date']));
    t('awsSigV4 相同输入输出确定', s1.Authorization === s2.Authorization);
  }
  {
    const o = {
      method: 'PUT', host: 'up.example.com', path: '/a.mp4', headers: {},
      payloadSha256: 'precomputed-hash', accessKey: 'ak', secretKey: 'sk', region: 'PH', service: 's3',
    };
    const s = awsSigV4(o);
    t('awsSigV4 流式场景使用预计算 payloadSha256', s['x-amz-content-sha256'] === 'precomputed-hash');
  }

  // ===== findItemIds =====
  {
    const obj = { data: { items: [{ item_id: 111, name: 'x' }, { itemId: '222' }], other: { my_itemid: 333 } } };
    const ids = findItemIds(obj);
    t('findItemIds 深度收集 item_id 变体', ids.length === 3 && ids.includes(111) && ids.includes('222') && ids.includes(333));
    t('findItemIds 空输入返回空数组', findItemIds(null).length === 0);
  }

  // ===== probeVideo =====
  {
    const r = probeVideo(buildMp4());
    t('probeVideo 解析出宽高', r.width === 1920 && r.height === 1080, `${r.width}x${r.height}`);
    t('probeVideo 解析出时长 ms', r.duration === 5000, `duration=${r.duration}`);
    t('probeVideo 空输入返回 0', probeVideo(Buffer.alloc(0)).duration === 0);
    t('probeVideo 非 mp4 数据不抛错', probeVideo(Buffer.from('not an mp4 at all')).width === 0);
  }

  // ===== probeVideoFile（文件级采样探针） =====
  {
    const tmp = path.join(os.tmpdir(), `kp_probe_${Date.now()}.mp4`);
    fs.writeFileSync(tmp, buildMp4());
    try {
      const r = probeVideoFile(tmp);
      t('probeVideoFile 解析出宽高', r.width === 1920 && r.height === 1080, `${r.width}x${r.height}`);
      t('probeVideoFile 解析出时长 ms', r.duration === 5000, `duration=${r.duration}`);
    } finally {
      fs.unlinkSync(tmp);
    }
    const bad = path.join(os.tmpdir(), `kp_probe_bad_${Date.now()}.mp4`);
    fs.writeFileSync(bad, 'not an mp4 at all');
    try {
      t('probeVideoFile 非 mp4 文件返回 0 不抛错', probeVideoFile(bad).width === 0);
    } finally {
      fs.unlinkSync(bad);
    }
  }

  // ===== validateUploadRow =====
  {
    const tmp = path.join(os.tmpdir(), `kp_tools_test_${Date.now()}.mp4`);
    fs.writeFileSync(tmp, 'test');
    try {
      t('validateUploadRow 缺路径报错', validateUploadRow({}) === '缺少视频路径');
      t('validateUploadRow 文件不存在报错', validateUploadRow({ path: tmp + '.nonexist' }).includes('不存在'));
      t('validateUploadRow 超长说明报错', validateUploadRow({ path: tmp, caption: 'x'.repeat(251) }).includes('250'));
      t('validateUploadRow 含 tiktok 字样报错', validateUploadRow({ path: tmp, caption: 'a tiktok b' }).includes('tiktok'));
      t('validateUploadRow 合法行通过', validateUploadRow({ path: tmp, caption: 'ok', product: '1' }) === '');
    } finally {
      fs.unlinkSync(tmp);
    }
  }

  // ===== TikTok 链接处理 =====
  t('extractUrls 只识别有效 tiktok 链接', extractUrls('https://www.tiktok.com/@a/video/123\nhttp://vm.tiktok.com/abc\n不是链接').length === 2);
  t('extractUrls 空输入返回空数组', extractUrls('').length === 0);
  t('extractVideoIdFromUrl 提取数字 id', extractVideoIdFromUrl('https://www.tiktok.com/@a/video/1234567890?x=1') === '1234567890');
  t('extractVideoIdFromUrl 短链接返回空串', extractVideoIdFromUrl('http://vm.tiktok.com/abc') === '');

  // ===== 错误分类 =====
  t('isNetworkError 识别网络错误', isNetworkError(new Error('getaddrinfo ENOTFOUND tiktok.com')) === true);
  t('isNetworkError 业务错误不误报', isNetworkError(new Error('视频不存在或已被删除')) === false);

  // ===== 代理检测与构造 =====
  {
    const old = process.env.HTTPS_PROXY;
    process.env.HTTPS_PROXY = 'http://127.0.0.1:7890';
    try {
      t('detectProxy 优先读环境变量', detectProxy() === 'http://127.0.0.1:7890');
    } finally {
      if (old === undefined) delete process.env.HTTPS_PROXY;
      else process.env.HTTPS_PROXY = old;
    }
    t('createAgent 空代理返回 undefined', createAgent('') === undefined);
    t('createAgent socks 代理', createAgent('socks5://127.0.0.1:1080').constructor.name === 'SocksProxyAgent');
    t('createAgent http 代理', createAgent('127.0.0.1:7890').constructor.name === 'HttpsProxyAgent');
  }

  // ===== 竞价金额换算 =====
  t('toAmount 空值返回空串', toAmount(null) === '' && toAmount('0') === '');
  t('toAmount 分转元', toAmount(100000) === 1);
  t('toAmount 四舍五入到分', toAmount(12345678) === 123.46);

  // ===== 开放平台：签名纯函数 =====
  t('nowSec 为整数秒且接近当前时间', Number.isInteger(nowSec()) && Math.abs(nowSec() - Date.now() / 1000) < 5, String(nowSec()));
  t('buildBaseString 无 token = partner_id+api_path+timestamp', buildBaseString('p1', '/api/v2/auth/token/get', 100) === 'p1/api/v2/auth/token/get100');
  t('buildBaseString 带 token = +access_token+shop_id', buildBaseString('p1', '/api/v2/x', 100, 'acc', 'shop') === 'p1/api/v2/x100accshop');
  t('buildBaseString 仅 access_token 时只拼 token', buildBaseString('p1', '/api/v2/x', 100, 'acc', '') === 'p1/api/v2/x100acc');
  t('buildBaseString 仅 shop_id 时只拼 shop_id', buildBaseString('p1', '/api/v2/x', 100, '', 'shop') === 'p1/api/v2/x100shop');
  t('hmacHex 与 crypto 标准实现一致', hmacHex('key', 'data') === crypto.createHmac('sha256', 'key').update('data').digest('hex'));
  t('hmacHex 输出小写 64 位 hex', /^[0-9a-f]{64}$/.test(hmacHex('k', 'd')));
  t('maskToken 保留前 8 后 4 位', maskToken('abcdefghijklmnop') === 'abcdefgh***mnop', maskToken('abcdefghijklmnop'));
  t('maskToken 短串保留首尾', maskToken('abc') === 'a***c', maskToken('abc'));
  t('maskToken 空串返回空', maskToken('') === '' && maskToken(null) === '');

  // ===== 开放平台：redirect 校验（自动回调 / 手动粘贴两种模式） =====
  {
    const { validateRedirect } = openapi._test;
    const ok = (url, mode) => {
      try { return validateRedirect(url).mode === mode; } catch { return false; }
    };
    const bad = (url) => {
      try { validateRedirect(url); return false; } catch { return true; }
    };
    t('redirect 127.0.0.1 本机地址 → auto', ok('http://127.0.0.1:8765/openapi/callback', 'auto'));
    t('redirect localhost → auto', ok('http://localhost:8765/openapi/callback', 'auto'));
    t('redirect sslip.io 通配域名 → auto', ok('http://127.0.0.1.sslip.io:8765/openapi/callback', 'auto'));
    t('redirect localtest.me / lvh.me → auto', ok('http://localtest.me:8765/openapi/callback', 'auto') && ok('http://lvh.me:8765/openapi/callback', 'auto'));
    t('redirect 本机地址端口不对 → 拒绝', bad('http://127.0.0.1:9999/openapi/callback'));
    t('redirect 本机地址路径不对 → 拒绝', bad('http://127.0.0.1:8765/other'));
    t('redirect 非白名单 http 域名 → manual（手动粘贴兜底）', ok('http://my.example.com/cb', 'manual'));
    t('redirect IP 地址（http）→ 拒绝', bad('http://1.2.3.4/cb'));
    t('redirect https 域名 → manual（手动粘贴兜底）', ok('https://my.example.com/cb', 'manual'));
    t('redirect 带查询参数 → 拒绝（官方要求不含 ?）', bad('https://my.example.com/cb?x=1'));
    t('redirect https 带端口域名 → manual', ok('https://my.example.com:8443/cb', 'manual'));
    t('redirect https 但 host 是 IP → 拒绝', bad('https://1.2.3.4/cb'));
    t('redirect 非 http(s) 协议 → 拒绝', bad('ftp://x.example.com/cb') && bad('not-a-url'));
  }

  // ===== 开放平台：凭证失效判定与刷新计划（纯函数） =====
  t('isAuthDead 命中网关 invalid_acceess_token 文案', isAuthDead('开放平台错误 invalid_acceess_token：Invalid access_token, please have a check.') === true);
  t('isAuthDead 命中 refresh token/shop_id 不匹配文案', isAuthDead('error_param：Your refresh token or shop_id is wrong, please check refresh token or shop_id.') === true);
  t('isAuthDead 命中 refresh token/merchant_id 不匹配文案', isAuthDead('error_param：Your refresh token or merchant_id is wrong') === true);
  t('isAuthDead 命中 refresh_token 过期文案', isAuthDead('error_refresh_token：Your refresh_token expired.') === true);
  t('isAuthDead 不命中普通业务/网络错误', isAuthDead('开放平台错误 error_param：缺少必填参数') === false && isAuthDead('连接超时') === false);
  t('isAuthRetryable 认证类错误可刷新重试', isAuthRetryable('开放平台错误 error_access_token：xxx') === true && isAuthRetryable('开放平台错误 invalid_acceess_token：Invalid access_token, please have a check.') === true);
  t('isAuthRetryable 普通错误不重试', isAuthRetryable('商品清单：接口超时') === false);
  {
    const shared = [
      { shopId: 's1', refreshToken: 'R', merchantId: 'M1' },
      { shopId: 's2', refreshToken: 'R', merchantId: 'M1' },
      { shopId: 's3', refreshToken: 'R2', merchantId: 'M1' },
    ];
    t('planRefresh 独立凭证 → individual', planRefresh({ shopId: 's3', refreshToken: 'R2', merchantId: 'M1' }, shared).mode === 'individual');
    const gm = planRefresh({ shopId: 's1', refreshToken: 'R', merchantId: 'M1' }, shared);
    t('planRefresh 共享同商户 → group-merchant（含组大小）', gm.mode === 'group-merchant' && gm.merchantId === 'M1' && gm.groupSize === 2);
    t('planRefresh 共享跨商户 → group-nomerchant', planRefresh({ shopId: 's1', refreshToken: 'R', merchantId: 'M1' }, [
      { shopId: 's1', refreshToken: 'R', merchantId: 'M1' },
      { shopId: 's2', refreshToken: 'R', merchantId: 'M2' },
    ]).mode === 'group-nomerchant');
    t('planRefresh 共享无 merchantId → group-nomerchant', planRefresh({ shopId: 's1', refreshToken: 'R', merchantId: '' }, [
      { shopId: 's1', refreshToken: 'R', merchantId: '' },
      { shopId: 's2', refreshToken: 'R', merchantId: '' },
    ]).mode === 'group-nomerchant');
  }

  // ===== 取消竞价：待改进列表解析 =====
  t('bidding-cancel toAmount 与 bidding 一致', biddingCancel.toAmount(12345678) === 123.46 && biddingCancel.toAmount(null) === '');
  {
    const data = {
      list: [
        {
          item_id: '111',
          item_name: '商品A',
          model_list: [
            {
              product_info: { model_id: 'm1', model_name: '型号1' },
              bidding_info: { bid_id: 'b1', bid_price: '17900000', default_suggest_price: '20700000' },
            },
            { product_info: { model_id: 'm2' }, bidding_info: { bid_price: '1' } }, // 无 bid_id，跳过
          ],
        },
        { item_id: '222', item_name: '商品B', model_list: [] },
      ],
    };
    const rows = biddingCancel.extractImprovementItems(data);
    t('extractImprovementItems 提取待改进竞价行', rows.length === 1 && rows[0].bidId === 'b1' && rows[0].itemId === '111' && rows[0].modelName === '型号1', JSON.stringify(rows));
    t('extractImprovementItems 金额换算正确', rows.length === 1 && rows[0].price === 179 && rows[0].suggestedPrice === 207, JSON.stringify(rows));
    t('extractImprovementItems 空数据返回空数组', biddingCancel.extractImprovementItems({ list: [] }).length === 0 && biddingCancel.extractImprovementItems(null).length === 0);
  }

  // ===== 取消注册 Hot Listing：SPU 解析与已注册列表提取 =====
  {
    t('parseSpuList 多行/逗号/空格混合解析并去重', (() => {
      const r = hotlistingCancel.parseSpuList('42555837160, 42555837161\n42555837160 123456789');
      return !r.error && r.spus.length === 3 && r.spus[0] === '42555837160' && r.spus[2] === '123456789';
    })());
    t('parseSpuList 数组输入', (() => {
      const r = hotlistingCancel.parseSpuList(['42555837160', '42555837161']);
      return !r.error && r.spus.length === 2;
    })());
    t('parseSpuList 空输入报错', !!hotlistingCancel.parseSpuList('').error && !!hotlistingCancel.parseSpuList('   ').error);
    t('parseSpuList 非法内容报错', (() => {
      const r = hotlistingCancel.parseSpuList('abc\n42555837160');
      return !!r.error && r.error.includes('abc');
    })());

    const data = {
      vrsku_info_list: [
        {
          vsku_info: { vsku_id: 325204957142, title: '商品A v', variation_name: '白色', vitem_id: 47152120886 },
          rsku_info: { rsku_id: 146728386921, title: '商品A', variation_name: 'White, 5m 50LED', seller_decision: 1, qualification_flags: 1, ritem_id: 22332369301 },
          vitem_info: { preview_link: 'https://shopee.ph/product/1/2' },
        },
        {
          vsku_info: { vsku_id: 2, vitem_id: 2 },
          rsku_info: { rsku_id: 2, seller_decision: 0 }, // 未注册，跳过
        },
        {
          vsku_info: { vsku_id: 3, vitem_id: 3 },
          rsku_info: { rsku_id: 3, seller_decision: 1, qualification_flags: 1 }, // 已注册且资格正常
        },
        {
          vsku_info: { vsku_id: 4, vitem_id: 4 },
          rsku_info: { rsku_id: 4, seller_decision: 1, qualification_flags: 0 }, // 资格异常（如 stock_unqualified），不可取消注册，跳过
        },
      ],
    };
    const rows = hotlistingCancel.extractEnrolledSkus(data);
    t('extractEnrolledSkus 只提取已注册且资格正常(seller_decision=1 & qualification_flags=1)行',
      rows.length === 2 && rows[0].rskuId === '146728386921' && rows[0].vskuId === '325204957142' && rows[1].rskuId === '3',
      JSON.stringify(rows));
    t('extractEnrolledSkus 提取标题/规格/预览链接', rows[0].itemName === '商品A' && rows[0].modelName === 'White, 5m 50LED' && rows[0].previewLink === 'https://shopee.ph/product/1/2');
    t('extractEnrolledSkus 空数据返回空数组', hotlistingCancel.extractEnrolledSkus({ vrsku_info_list: [] }).length === 0 && hotlistingCancel.extractEnrolledSkus(null).length === 0);

    // 按店铺 SPU 配置：归一化 + 汇总
    t('normalizeSpuMap 归一化并丢弃非法项', (() => {
      const m = hotlistingCancel.normalizeSpuMap({ 557630453: '  42555837160\n123 ', abc: '1', '557630454': '   ', '557630455': 12345 });
      return Object.keys(m).length === 2 && m['557630453'] === '42555837160\n123' && m['557630455'] === '12345';
    })());
    t('normalizeSpuMap 非对象输入返回空对象', Object.keys(hotlistingCancel.normalizeSpuMap(null)).length === 0 && Object.keys(hotlistingCancel.normalizeSpuMap('x')).length === 0);
    t('resolvePerShopSpus 请求体为完整状态（清空也生效）', (() => {
      const r = hotlistingCancel.resolvePerShopSpus(['1', '2'], { 1: '11111\n22222', 2: '' }, { 1: '99999', 2: '33333' });
      return r.perShop['1'].spus.join(',') === '11111,22222' && !!r.perShop['2'].error && r.validCount === 2;
    })());
    t('resolvePerShopSpus 无请求体时回落已保存配置', (() => {
      const r = hotlistingCancel.resolvePerShopSpus(['1', '2'], null, { 1: '99999', 2: '33333' });
      return r.perShop['1'].spus[0] === '99999' && r.perShop['2'].spus[0] === '33333' && r.validCount === 2;
    })());
    t('resolvePerShopSpus 未配置店铺返回 error', (() => {
      const r = hotlistingCancel.resolvePerShopSpus(['1', '2'], null, { 1: '11111' });
      return !r.perShop['1'].error && !!r.perShop['2'].error && r.validCount === 1;
    })());
    t('resolvePerShopSpus 非法 SPU 内容返回 parseSpuList 错误', (() => {
      const r = hotlistingCancel.resolvePerShopSpus(['1'], { 1: 'abc' }, {});
      return !!r.perShop['1'].error && r.perShop['1'].error.includes('abc');
    })());
  }

  // ===== 任务取消（确定性验证，不依赖网络与服务） =====
  {
    const { processJob, jobEvents, abortedJobs, finishJob } = video._test;
    // 场景 A：任务开始前已标记取消 → 一行都不执行，广播 cancelled
    const jobA = 'cancel-test-a';
    abortedJobs.add(jobA);
    let callsA = 0;
    await processJob(jobA, [{ path: 'x' }, { path: 'y' }], {}, async () => { callsA++; return {}; });
    const evsA = jobEvents.get(jobA) || [];
    t('取消：已标记任务不执行任何行', callsA === 0, `calls=${callsA}`);
    t('取消：广播 cancelled 事件', evsA.some((e) => e.type === 'cancelled'), JSON.stringify(evsA));
    t('取消：cancelled 携带 total', (evsA.find((e) => e.type === 'cancelled') || {}).total === 2);
    t('取消：不再广播 finished', !evsA.some((e) => e.type === 'finished'));
    finishJob(jobA);

    // 场景 B：第一行完成后标记取消 → 停止后续行，广播 cancelled
    const jobB = 'cancel-test-b';
    let callsB = 0;
    await processJob(jobB, [{ path: 'a' }, { path: 'b' }, { path: 'c' }], {}, async () => {
      callsB++;
      if (callsB === 1) abortedJobs.add(jobB);
      return {};
    });
    const evsB = jobEvents.get(jobB) || [];
    t('取消：中途取消停止后续行', callsB === 1, `calls=${callsB}`);
    t('取消：中途取消收到 cancelled', evsB.some((e) => e.type === 'cancelled'), JSON.stringify(evsB));
    t('取消：row-done 与 cancelled 同时存在', evsB.some((e) => e.type === 'row-done') && evsB.some((e) => e.type === 'cancelled'));
    finishJob(jobB);
  }

  // ===== 共享层：请求体解析 / 卖家中心 URL 拼接 / 导出工具（四模块收敛后的公共契约） =====
  {
    t('parseJsonText 容忍 UTF-8 BOM', parseJsonText('\uFEFF{"a":1}').a === 1 && parseJsonText('{"b":2}').b === 2);
    t('parseJsonText 非法 JSON 抛错', (() => {
      try { parseJsonText('not-json'); return false; } catch { return true; }
    })());

    const u = buildShopeeUrl('/api/mkt/buybox/update_enroll', {
      shopId: '557630453', region: 'ph', spcCds: 'abc123',
      business: { page_number: 1, page_size: 45, empty: '', nil: null },
    });
    t('buildShopeeUrl 拼接 HOST + 路径 + 公共参数',
      u.startsWith(`${HOST}/api/mkt/buybox/update_enroll?`) && u.includes('SPC_CDS_VER=2')
      && u.includes('SPC_CDS=abc123') && u.includes('cnsc_shop_id=557630453') && u.includes('cbsc_shop_region=ph'), u);
    t('buildShopeeUrl 带业务参数且跳过空值',
      u.includes('page_number=1') && u.includes('page_size=45') && !u.includes('empty=') && !u.includes('nil='), u);
    t('buildShopeeUrl 无 region 时不产出 cbsc_shop_region（商品导出用）',
      !buildShopeeUrl('/api/v3/product/get_product_info', { shopId: '1', business: { product_id: 'x' } }).includes('cbsc_shop_region'));
    t('buildShopeeUrl 无 SPC_CDS 时跳过该参数', !buildShopeeUrl('/x', { shopId: '1' }).includes('SPC_CDS='));
    t('DEFAULT_REGION 与竞价系原兜底口径一致', DEFAULT_REGION === 'ph');

    t('timestampText 形如 YYYY-MM-DD_HHmmss', /^\d{4}-\d{2}-\d{2}_\d{6}$/.test(timestampText(new Date(2026, 8, 11, 20, 5, 7))), timestampText());
    t('timestampText 补零', timestampText(new Date(2026, 0, 3, 4, 5, 6)) === '2026-01-03_040506', timestampText(new Date(2026, 0, 3, 4, 5, 6)));
    t('defaultOutDir 指向用户下载目录', defaultOutDir().endsWith('Downloads'), defaultOutDir());
    {
      const dir = path.join(os.tmpdir(), `kp_export_${Date.now()}`, 'a', 'b');
      try {
        t('ensureDir 递归创建目录', ensureDir(dir) === dir && fs.existsSync(dir));
        t('ensureDir 空入参回落默认下载目录', ensureDir('') === defaultOutDir());
      } finally {
        try { fs.rmSync(path.dirname(dir), { recursive: true, force: true }); } catch { /* 忽略 */ }
      }
    }
  }

  // ===== 监控：规则引擎（纯函数） =====
  {
    const upRule = { id: 'r1', metric: 'order.pending_24h', type: 'threshold', thresholds: { p2: 3, p1: 8, p0: 15 } };
    t('规则评估 up：低于 p2 不触发', evaluateRule(upRule, 2) === null);
    t('规则评估 up：命中 p2', evaluateRule(upRule, 5) === 'P2');
    t('规则评估 up：边界值命中 p2', evaluateRule(upRule, 3) === 'P2');
    t('规则评估 up：命中 p1', evaluateRule(upRule, 9) === 'P1');
    t('规则评估 up：命中 p0', evaluateRule(upRule, 16) === 'P0');
    const downRule = { id: 'r2', metric: 'health.rating', type: 'threshold', thresholds: { p2: 4.5, p1: 4.2, p0: 4.0 } };
    t('规则评估 down：评分低触发 P1', evaluateRule(downRule, 4.1) === 'P1');
    t('规则评估 down：评分正常不触发', evaluateRule(downRule, 4.8) === null);
    const noP2 = { id: 'r3', metric: 'health.penalty_points', type: 'threshold', thresholds: { p1: 1, p0: 3 } };
    t('规则评估 缺 p2 阈值：低值不触发', evaluateRule(noP2, 0) === null);
    t('规则评估 缺 p2 阈值：直接命中 p1', evaluateRule(noP2, 2) === 'P1');
    t('规则评估 非法值返回 null', evaluateRule(upRule, NaN) === null && evaluateRule(upRule, '5') === null && evaluateRule(null, 5) === null);
    t('isMoreSevere 级别比较', isMoreSevere('P0', 'P1') && isMoreSevere('P1', 'P2') && !isMoreSevere('P2', 'P1') && isMoreSevere('P0', null) && !isMoreSevere(null, 'P1'));
    {
      const merged = mergeRules({ 'order.pending_24h': { thresholds: { p2: 5 }, enabled: false } });
      const r = merged.find((x) => x.id === 'order.pending_24h');
      t('mergeRules 覆盖阈值且未覆盖级别保留默认', r.thresholds.p2 === 5 && r.thresholds.p1 === 8);
      t('mergeRules 覆盖开关', r.enabled === false);
      t('mergeRules 未覆盖规则保持默认', merged.find((x) => x.id === 'order.cancel_pending').thresholds.p2 === 3);
      t('mergeRules 空覆盖返回默认全集', mergeRules(null).length === mergeRules({}).length);
    }
    {
      const r = levelOf('product.violations', 5);
      t('levelOf 矩阵定级', r.level === 'P1' && r.rule != null, JSON.stringify(r));
      t('levelOf 未注册指标返回 null', levelOf('nope.x', 5).level === null);
    }
  }

  // ===== 监控：采集解析纯函数 =====
  {
    const now = Date.now();
    // 生成指定天数偏移的 order_sn（YYMMDD 前缀 + 任意后缀）
    const daySn = (offsetDays) => {
      const d = new Date(now + offsetDays * 86400000);
      const p = (n) => String(n).padStart(2, '0');
      return String(d.getFullYear()).slice(2) + p(d.getMonth() + 1) + p(d.getDate()) + 'ABCDEF';
    };
    const b = orderAgeBuckets([{ order_sn: daySn(0) }, { order_sn: daySn(-1) }, { order_sn: daySn(-2) }, { order_sn: daySn(-3) }], now);
    t('orderAgeBuckets 按单号日期分桶', b.pending_12_24h === 1 && b.pending_24h === 3, JSON.stringify(b));
    t('orderAgeBuckets 空数组全 0', orderAgeBuckets([], now).pending_24h === 0 && orderAgeBuckets(null, now).pending_12_24h === 0);
    t('orderSnDate 解析 YYMMDD 前缀', (() => {
      const d = orderSnDate('260816G8NXB128');
      return d && d.getFullYear() === 2026 && d.getMonth() === 7 && d.getDate() === 16;
    })());
    t('orderSnDate 非法单号返回 null', orderSnDate('ABC123') === null && orderSnDate('') === null && orderSnDate(null) === null);
    {
      const items = [
        { stock_info_v2: { summary_info: { total_available_stock: 0 } } },
        { stock_info_v2: { summary_info: { total_available_stock: 3 } } },
        { stock_info_v2: { summary_info: { total_available_stock: 20 } } },
        { stock: 0 },
        { stock: 2 },
        {},
      ];
      const s = stockSummary(items, 5);
      t('stockSummary 断货/低库存统计', s.out_of_stock === 2 && s.low_stock === 2, JSON.stringify(s));
      t('stockOfModel 读 summary_info', stockOfModel(items[0]) === 0 && stockOfModel(items[1]) === 3);
      t('stockOfModel 无库存字段返回 null', stockOfModel(items[5]) === null);
      // 商品粒度：全型号合计（停产变体不撑爆断货数）
      t('itemStockState 全 0 → out', itemStockState([{ stock: 0 }, { stock: 0 }]) === 'out');
      t('itemStockState 合计 ≤ 安全线 → low', itemStockState([{ stock: 0 }, { stock: 3 }], 5) === 'low');
      t('itemStockState 合计充足 → ok', itemStockState([{ stock: 0 }, { stock: 20 }], 5) === 'ok');
      t('itemStockState 无库存数据 → null', itemStockState([{}, { stock: null }]) === null && itemStockState([]) === null);
    }
    {
      const h = normalizeHealth({
        response: {
          metric_list: [
            { metric_name: 'late_shipment_rate', current_period: 0.03 },
            { metric_name: 'non_fulfillment_rate', current_period: 0.37 },
            { metric_name: 'shop_rating', current_period: 4.78 },
          ],
          overall_performance: { rating: 4 },
        },
      });
      t('normalizeHealth 解析 metric_list', h.late_shipment_rate === 0.03 && h.non_fulfilment_rate === 0.37 && h.rating === 4.78, JSON.stringify(h));
      const h2 = normalizeHealth({ response: { overall_performance: { rating: '4.5' } } });
      t('normalizeHealth 缺 metric_list 回退 overall_performance', h2.rating === 4.5 && h2.late_shipment_rate === null);
      t('normalizeHealth 异常输入全 null', normalizeHealth(null).rating === null && normalizeHealth({}).late_shipment_rate === null);
    }
    t('totalOf 支持字符串数字与 response 包装', totalOf({ response: { total_count: '42' } }) === 42 && totalOf({ total: 7 }) === 7);
    t('totalOf 缺失返回 null', totalOf({}) === null && totalOf(null) === null);
    t('listOf 支持 response/顶层多字段', listOf({ response: { order_list: [1, 2] } }, ['order_list', 'list']).length === 2
      && listOf({ list: [1] }, ['order_list', 'list']).length === 1
      && listOf({ response: { model: [{ a: 1 }] } }, ['model', 'models']).length === 1);
    t('listOf 异常输入返回空数组', listOf(null, ['x']).length === 0 && listOf({}, ['x']).length === 0);
  }

  // ===== 监控：Roadmap 新增域解析纯函数（广告/资金/售后/处罚/明细/权限） =====
  {
    t('formatDdMmYyyy 月日补零', formatDdMmYyyy(new Date(2026, 7, 6)) === '06-08-2026', formatDdMmYyyy(new Date(2026, 7, 6)));
    t('formatDdMmYyyy 年月日不补零', formatDdMmYyyy(new Date(2026, 10, 12)) === '12-11-2026');
    const agg = normalizeAdsHourly([
      { expense: 10, direct_gmv: 30, clicks: 5 },
      { expense: 20, direct_gmv: 70, clicks: 15 },
      {},
      null,
    ]);
    t('normalizeAdsHourly 聚合花费/ROAS/CPC', agg.spend === 30 && agg.roas === 3.33 && agg.cpc === 1.5, JSON.stringify(agg));
    t('normalizeAdsHourly 空数据全 null', normalizeAdsHourly([]).spend === null && normalizeAdsHourly(null).roas === null && normalizeAdsHourly([{}]).cpc === null);
    t('normalizeAdsHourly 零点击不产出 CPC', normalizeAdsHourly([{ expense: 10, direct_gmv: 20, clicks: 0 }]).cpc === null);
    t('normalizeAdsHourly 零花费不产出 ROAS', normalizeAdsHourly([{ expense: 0, direct_gmv: 20, clicks: 2 }]).roas === null);
    t('normalizeBalance 读 response.total_balance', normalizeBalance({ response: { total_balance: 12.5 } }) === 12.5);
    t('normalizeBalance 字符串数字兜底', normalizeBalance({ response: { total_balance: '7.5' } }) === 7.5);
    t('normalizeBalance 缺失返回 null', normalizeBalance({}) === null && normalizeBalance(null) === null);
    {
      const p = normalizePunishments({ response: { total_count: 3, punishment_list: [{ reason: 1 }] } });
      t('normalizePunishments 优先取 total_count', p.count === 3 && p.detail === 'Tier1×1', JSON.stringify(p));
      const p2 = normalizePunishments({ response: { punishment_list: [{ reason: 2 }, { reason: 2 }, { reason: 5 }] } });
      t('normalizePunishments 无 total_count 回退列表长度与级别分布', p2.count === 3 && p2.detail === 'Tier2×2/Tier5×1', JSON.stringify(p2));
      t('normalizePunishments 空数据 count=0 明细空串', normalizePunishments({ response: {} }).count === 0 && normalizePunishments(null).detail === '');
    }
    t('violationBreakdown reason 中文映射聚合', violationBreakdown([{ item_id: 1, reason: 1 }, { item_id: 2, reason: 1 }, { item_id: 3, reason: 2 }, { item_id: 4 }]) === '违禁商品2/假冒商品1');
    t('violationBreakdown 空列表空串', violationBreakdown([]) === '' && violationBreakdown(null) === '');
    {
      const ws = walletSummary([
        { status: 'PENDING', current_balance: 100, create_time: 1 },
        { status: 'FAILED', current_balance: 90, create_time: 2 },
        { status: 'INITIAL', current_balance: 80, create_time: 3 },
        { status: 'COMPLETED', current_balance: 70, create_time: 4 },
      ]);
      t('walletSummary 状态计数与最新余额', ws.pending === 2 && ws.failed === 1 && ws.balance === 70, JSON.stringify(ws));
      t('walletSummary 空输入全 0/余额 null', walletSummary([]).pending === 0 && walletSummary(null).failed === 0 && walletSummary(null).balance === null);
      t('walletSummary 状态大小写不敏感', walletSummary([{ status: 'pending', current_balance: 5 }]).pending === 1);
    }
    {
      const now = Date.now();
      const rs = returnSummary([
        { reason: 'ITEM_DAMAGED', create_time: Math.floor((now - 3600000) / 1000) },
        { reason: 'WRONG_ITEM', create_time: Math.floor((now - 2 * 3600000) / 1000) },
        { reason: 'ITEM_DAMAGED', create_time: Math.floor((now - 3 * 3600000) / 1000) },
        { reason: 'OTHER', create_time: Math.floor((now - 2 * 86400000) / 1000) }, // 超 24h 不计
        {},
      ], now);
      t('returnSummary 24h 过滤与原因聚合', rs.count === 3 && rs.detail === '商品损坏2/发错商品1', rs.detail);
      t('returnSummary 未知原因兜底', returnSummary([{ reason: 'XXX', create_time: Math.floor(now / 1000) }], now).detail === 'XXX1');
      t('returnSummary 空输入全 0', returnSummary([], now).count === 0 && returnSummary(null, now).detail === '');
    }
    {
      const now = Date.now();
      const cs = commentSummary([
        { rating_star: 1, comment: '质量差 假货', create_time: Math.floor((now - 3600000) / 1000) },
        { rating_star: 2, comment: '太慢', create_time: Math.floor((now - 3 * 3600000) / 1000) },
        { rating_star: 5, comment: '很好', create_time: Math.floor((now - 3600000) / 1000) },
        { rating_star: 1, comment: '坏了', create_time: Math.floor((now - 2 * 86400000) / 1000) }, // 超 24h 不计
      ], null, now);
      t('commentSummary 1~3 星差评过滤', cs.count === 2, JSON.stringify(cs));
      t('commentSummary 关键词命中明细', cs.detail.includes('质量差') && cs.detail.includes('假货') && cs.detail.includes('太慢'), cs.detail);
      t('commentSummary 自定义关键词', commentSummary([{ rating_star: 1, comment: '色差', create_time: Math.floor(now / 1000) }], ['色差'], now).detail.includes('「色差」1'));
      t('commentSummary 空输入全 0', commentSummary([], null, now).count === 0);
    }
    t('isPermissionDenied 命中权限类错误', isPermissionDenied('开放平台错误 error_no_permission：you have no permission to access this api') === true
      && isPermissionDenied('not authorized for this api') === true && isPermissionDenied('无权访问该接口') === true);
    t('isPermissionDenied 普通错误不误报', isPermissionDenied('网络连接超时') === false && isPermissionDenied('') === false && isPermissionDenied(null) === false);
  }

  // ===== 监控：告警引擎生命周期 =====
  {
    const engine = monitorEngine;
    const now = Date.now();
    // 触发与去重
    engine.ingest('T1', 'order', { 'order.pending_24h': 4 }, now); // P2（阈值 p2=3）
    let list = engine.getAlerts({ shopId: 'T1' });
    t('引擎：首次触发生成 P2 告警', list.length === 1 && list[0].level === 'P2' && list[0].status === 'open' && list[0].count === 1, JSON.stringify(list));
    engine.ingest('T1', 'order', { 'order.pending_24h': 6 }, now + 60000);
    list = engine.getAlerts({ shopId: 'T1' });
    t('引擎：同级别去重计数', list.length === 1 && list[0].count === 2);
    // 升级
    engine.ingest('T1', 'order', { 'order.pending_24h': 10 }, now + 120000); // P1
    engine.ingest('T1', 'order', { 'order.pending_24h': 16 }, now + 180000); // P0
    list = engine.getAlerts({ shopId: 'T1' });
    t('引擎：阈值升级 P2→P1→P0', list.length === 1 && list[0].level === 'P0', JSON.stringify(list));
    // 恢复
    engine.ingest('T1', 'order', { 'order.pending_24h': 1 }, now + 240000);
    list = engine.getAlerts({ shopId: 'T1', status: 'recovered' });
    t('引擎：回到阈值内自动恢复', list.length === 1 && list[0].status === 'recovered' && list[0].recoveredAt != null);
    // 恢复后再次触发 → 重新打开
    engine.ingest('T1', 'order', { 'order.pending_24h': 4 }, now + 300000);
    list = engine.getAlerts({ shopId: 'T1', status: 'open' });
    t('引擎：恢复后再次触发重新打开', list.length === 1 && list[0].status === 'open');
    // 确认 / 关闭 / 关闭后再触发 seq+1
    const id = list[0].id;
    engine.ackAlert(id);
    t('引擎：确认后状态 ack', engine.getAlerts({ shopId: 'T1', status: 'ack' }).length === 1);
    engine.closeAlert(id);
    t('引擎：关闭后默认列表不可见', engine.getAlerts({ shopId: 'T1' }).filter((a) => a.id === id).length === 0);
    const seqBefore = engine.getAlerts({ shopId: 'T1', status: 'closed' })[0].seq;
    engine.ingest('T1', 'order', { 'order.pending_24h': 4 }, now + 360000);
    list = engine.getAlerts({ shopId: 'T1', status: 'open' });
    t('引擎：关闭后再次触发重新打开且 seq+1', list.length === 1 && list[0].seq === seqBefore + 1);
  }

  // ===== 监控：告警消息明细（ingest 第 5 参 details） =====
  {
    const engine = monitorEngine;
    const now = Date.now();
    engine.ingest('T4', 'product', { 'product.violations': 2 }, now, { 'product.violations': '明细 违禁商品1/假冒商品1' });
    let a = engine.getAlerts({ shopId: 'T4' })[0];
    t('引擎：details 明细拼入新建告警消息', !!a && a.message.includes('明细 违禁商品1/假冒商品1'), a && a.message);
    engine.ingest('T4', 'product', { 'product.violations': 3 }, now + 60000, { 'product.violations': '明细 违禁商品2/滥用1' });
    a = engine.getAlerts({ shopId: 'T4' })[0];
    t('引擎：更新时刷新明细消息', !!a && a.count === 2 && a.message.includes('违禁商品2/滥用1'), a && a.message);
    engine.ingest('T4', 'product', { 'product.violations': 1 }, now + 120000); // 不带 details
    a = engine.getAlerts({ shopId: 'T4' })[0];
    t('引擎：无 details 时消息回退基础文案（向后兼容）', !!a && !a.message.includes('明细'), a && a.message);
    engine.closeAlert(a.id);
  }

  // ===== 监控：金额换算（人民币阈值口径 + 全局展示模式） =====
  {
    const { toRmb, fromRmb, regionCurrency, symbolOf, moneyText, roundMoney } = currency;
    t('toRmb 人民币不换算', toRmb(100, 'CNY') === 100);
    t('toRmb 泰铢按内置汇率换算', toRmb(500, 'THB') === 500 * 0.21, String(toRmb(500, 'THB')));
    t('toRmb 未知币种按 1:1 保守处理', toRmb(50, 'XXX') === 50);
    t('toRmb 非数值原样返回', toRmb(null, 'THB') === null && toRmb(undefined, 'THB') === undefined);
    t('fromRmb 与 toRmb 互逆', Math.abs(fromRmb(toRmb(123.45, 'THB'), 'THB') - 123.45) < 1e-9);
    t('regionCurrency 地区代码映射（大小写不敏感）', regionCurrency('TH') === 'THB' && regionCurrency('cn') === 'CNY' && regionCurrency('') === '' && regionCurrency(null) === '');
    t('symbolOf 币种符号与未知兜底', symbolOf('THB') === '฿' && symbolOf('CNY') === '¥' && symbolOf('XXX') === 'XXX');
    t('moneyText 当地货币展示原始值', moneyText(500, 'THB', 'local') === '500 ฿');
    t('moneyText 人民币模式换算展示', moneyText(500, 'THB', 'rmb') === '105 元', moneyText(500, 'THB', 'rmb'));
    t('moneyText 非数值显示 —', moneyText(null, 'THB', 'rmb') === '—');
    t('roundMoney 保留两位小数', roundMoney(1.234) === 1.23 && roundMoney(105) === 105);
  }
  {
    const engine = monitorEngine;
    const now = Date.now();
    monitorStore.patchMeta((meta) => { meta.shops['T5'] = { currency: 'THB' }; });
    monitorStore.setCurrencyMode('rmb');
    // ads.spend_today 阈值 p2=100 元（人民币）：500 泰铢 ≈ 105 元 → P2；400 泰铢 ≈ 84 元 → 不触发
    engine.ingest('T5', 'ads', { 'ads.spend_today': 500 }, now);
    let a = engine.getAlerts({ shopId: 'T5' })[0];
    t('引擎：金额指标按人民币换算比较阈值（500泰铢≈105元触发P2）', !!a && a.level === 'P2' && a.current === 500, JSON.stringify(a));
    engine.ingest('T5', 'ads', { 'ads.spend_today': 400 }, now + 60000);
    a = engine.getAlerts({ shopId: 'T5' })[0];
    t('引擎：换算后回落阈值内自动恢复（400泰铢≈84元）', a.status === 'recovered', JSON.stringify(a));
    engine.ingest('T5', 'ads', { 'ads.spend_today': 500 }, now + 120000);
    a = engine.getAlerts({ shopId: 'T5' })[0];
    t('引擎：rmb 模式告警消息换算为人民币', !!a && a.status === 'open' && a.message.includes('105 元'), a && a.message);
    monitorStore.setCurrencyMode('local');
    t('引擎：local 模式告警消息为当地货币原始值', monitorEngine.renderAlertMessage(a).includes('500 ฿'), monitorEngine.renderAlertMessage(a));
    // 未识别币种（CNY）：两种模式数值一致
    monitorStore.patchMeta((meta) => { meta.shops['T6'] = { currency: 'CNY' }; });
    monitorStore.setCurrencyMode('rmb');
    engine.ingest('T6', 'ads', { 'ads.spend_today': 80 }, now);
    t('引擎：人民币店铺按原值比较不触发', engine.getAlerts({ shopId: 'T6' }).length === 0, JSON.stringify(engine.getAlerts({ shopId: 'T6' })));
    engine.closeAlert(a.id);
    monitorStore.setCurrencyMode('rmb');
  }

  // ===== 监控：系统自检告警与时间升级 =====
  {
    const engine = monitorEngine;
    const now = Date.now();
    engine.systemFail('T2', 'order', '网络错误', now);
    let a = engine.getAlerts({ shopId: 'T2' })[0];
    t('系统告警：1 次失败 P2', !!a && a.domain === 'system' && a.level === 'P2' && a.status === 'open');
    engine.systemFail('T2', 'order', '网络错误', now + 1000);
    a = engine.getAlerts({ shopId: 'T2' })[0];
    t('系统告警：2 次失败升级 P1', a.level === 'P1' && a.current === 2, JSON.stringify(a));
    engine.systemFail('T2', 'order', '网络错误', now + 2000);
    a = engine.getAlerts({ shopId: 'T2' })[0];
    t('系统告警：3 次失败仍为 P1', a.level === 'P1');
    engine.systemFail('T2', 'order', '网络错误', now + 3000);
    engine.systemFail('T2', 'order', '网络错误', now + 4000);
    a = engine.getAlerts({ shopId: 'T2' })[0];
    t('系统告警：5 次失败升级 P0', a.level === 'P0' && a.current === 5);
    engine.systemOk('T2', now + 5000);
    a = engine.getAlerts({ shopId: 'T2', status: 'recovered' })[0];
    t('系统告警：采集成功自动恢复', !!a && a.status === 'recovered');
    // 时间升级：P2 挂 24h → P1
    engine.ingest('T3', 'order', { 'order.pending_12_24h': 6 }, now); // P2（阈值 p2=5）
    const t3 = monitorEngine._test.alerts.find((x) => x.shopId === 'T3');
    t3.firstAt = now - 25 * 3600 * 1000;
    engine.maintain(now + 60 * 1000);
    a = engine.getAlerts({ shopId: 'T3' })[0];
    t('引擎：P2 持续 24h 自动升级 P1', a.level === 'P1', JSON.stringify(a));
    // 汇总
    const s = engine.summary();
    t('引擎汇总：按店按级别计数', s.byShop['T1'].P2 === 1 && s.byShop['T3'].P1 === 1 && s.totals.P0 === 0 && s.totals.P1 === 1 && s.totals.P2 === 1 && s.totals.recovered === 1, JSON.stringify(s));
    // 汇总白名单（只统计启用监控的店铺）
    const s2 = engine.summary(new Set(['T1']));
    t('引擎汇总：按监控店铺白名单过滤', !!s2.byShop['T1'] && !s2.byShop['T2'] && !s2.byShop['T3'] && s2.totals.P2 === 1, JSON.stringify(s2));
    // 停用监控：关闭该店全部未关闭告警
    const closedCount = engine.closeShopAlerts('T1');
    t('引擎：closeShopAlerts 关闭该店全部未关闭告警', closedCount === 1 && engine.getAlerts({ shopId: 'T1', status: 'open' }).length === 0 && engine.getAlerts({ shopId: 'T3', status: 'open' }).length === 1, JSON.stringify({ closedCount, t3: engine.getAlerts({ shopId: 'T3' }) }));
  }

  // ===== 监控：快照存储与规则覆盖持久化 =====
  {
    const now = Date.now();
    monitorStore.appendSample('S1', 'order.pending_24h', 5, now);
    monitorStore.appendSample('S1', 'order.pending_24h', 8, now + 60000);
    const pts = monitorStore.readTrend('S1', 'order.pending_24h', 7);
    t('快照：写入后可读回且按时间升序', pts.length === 2 && pts[0].v === 5 && pts[1].v === 8, JSON.stringify(pts));
    t('快照：不存在的店铺/指标返回空', monitorStore.readTrend('S1', 'nope.x', 7).length === 0);
    let threw = false;
    try { monitorStore.setRuleOverrides({ 'unknown.rule': { enabled: false } }); } catch { threw = true; }
    t('规则覆盖：未知规则 id 报错', threw);
    const rules = monitorStore.setRuleOverrides({ 'order.pending_24h': { thresholds: { p2: 6 } } });
    t('规则覆盖：保存并生效', rules.find((r) => r.id === 'order.pending_24h').thresholds.p2 === 6);
    monitorStore.setRuleOverrides({});
    t('规则覆盖：清空后还原默认', monitorStore.getRules().find((r) => r.id === 'order.pending_24h').thresholds.p2 === 3);
    // 监控店铺配置（排除名单）：默认全部监控
    t('店铺配置：默认全部监控', monitorStore.isMonitored('S1') && monitorStore.isMonitored('S9') && monitorStore.getExcludedShopIds().size === 0);
    monitorStore.setExcludedShopIds(['S9', 'S9', 123]);
    t('店铺配置：保存排除名单并去重转字符串', !monitorStore.isMonitored('S9') && !monitorStore.isMonitored('123') && monitorStore.isMonitored('S1') && monitorStore.getExcludedShopIds().size === 2);
    let badThrew = false;
    try { monitorStore.setExcludedShopIds('x'); } catch { badThrew = true; }
    t('店铺配置：非数组报错', badThrew);
    monitorStore.setExcludedShopIds([]);
    t('店铺配置：清空排除名单后恢复监控', monitorStore.isMonitored('S9') && monitorStore.getExcludedShopIds().size === 0);
    // 收尾：落盘并清理临时目录
    monitorEngine.flushAlerts();
    monitorStore.flushMeta();
    try { fs.rmSync(MONITOR_TMP, { recursive: true, force: true }); } catch { /* 忽略 */ }
  }

  // ===== 商品数据导出：纯函数（列表/详情 → 规格行） =====
  {
    t('商品导出：imageUrlOf 按市场拼 down-{region} 直链 / 已是链接原样 / 空值返回空串',
      imageUrlOf('cn-11134207-820l4-monpa1s8re31ea', 'ph') === 'https://down-ph.img.susercontent.com/cn-11134207-820l4-monpa1s8re31ea'
      && imageUrlOf('sg-11134201-abc', 'MY') === 'https://down-my.img.susercontent.com/sg-11134201-abc'
      && imageUrlOf('sg-11134201-abc') === 'https://cf.shopee.sg/file/sg-11134201-abc'
      && imageUrlOf('https://x.com/a.png', 'ph') === 'https://x.com/a.png'
      && imageUrlOf('') === '' && imageUrlOf(null) === '');
    t('商品导出：statusNameOf 1→在售，其余原样', statusNameOf(1) === '在售' && statusNameOf('9') === '9' && statusNameOf(null) === '');
    t('商品导出：firstStr 按候选顺序取第一个非空', firstStr({ a: '', b: 0, c: 'x' }, ['a', 'b', 'c']) === '0');
    t('商品导出：productsOf/totalOf 容错取列表与总数', productsOf({ data: { products: [1, 2] } }).length === 2 && peTotalOf({ data: { page_info: { total: 12 } } }) === 12 && peTotalOf({}) === 0);
    t('商品导出：tiersOf 兼容 tier_variation 单复数字段', tiersOf({ tier_variation: [{ name: '颜色' }] }).length === 1 && tiersOf({ tier_variations: [{ name: '尺码' }] }).length === 1);

    // 与生产实测一致的 fixtures（2026-08 实测形态）
    const product = {
      id: 23927842651, name: '测试商品', status: 1,
      parent_sku: 'P-001', cover_image: 'sg-11134201-cover',
      modify_time: 1786678500,
      model_list: [
        { id: 111, name: 'M-A', sku: 'SKU-A', tier_index: [0, 1], image: 'cn-11134207-m1',
          stock_detail: { total_available_stock: 58 },
          price_detail: { origin_price: '1337.00', promotion_price: '429.00' },
          statistics: { sold_count: 45 } },
        { id: 222, name: 'M-B', sku: 'SKU-B', tier_index: [1, 0], image: 'cn-11134207-m2',
          stock_detail: { total_available_stock: 726 },
          price_detail: { origin_price: '1337.00', promotion_price: '449.00' },
          statistics: { sold_count: 1175 } },
      ],
    };
    const detail = {
      tier_variation: [
        { name: '颜色', options: ['红', '蓝'], images: ['sg-11134201-c1', 'sg-11134201-c2'] },
        { name: '尺寸', options: ['S', 'M'], images: ['sg-11134201-s1', 'sg-11134201-s2'] },
      ],
      model_list: [
        { id: 111, sku: 'SKU-A', tier_index: [0, 1], price_info: { input_normal_price: '1337.00', input_promotion_price: '429.00' }, stock_detail: { total_available_stock: 58 } },
        { id: 222, sku: 'SKU-B', tier_index: [1, 0], price_info: { input_normal_price: '1337.00', input_promotion_price: '449.00' }, stock_detail: { total_available_stock: 726 } },
      ],
    };
    const rows = buildRows(product, detail, '557630453', 'ph');
    t('商品导出：每个规格一行（商品+规格字段齐）', rows.length === 2
      && rows[0].itemId === '23927842651' && rows[0].modelId === '111' && rows[0].sku === 'SKU-A'
      && rows[0].status === '在售' && rows[0].normalPrice === '1337.00' && rows[0].stock === '58'
      && rows[0].sold === '45' && rows[0].detailUrl.includes('/portal/product/23927842651')
      && rows[0].updateTime === '1786678500', JSON.stringify(rows[0]));
    t('商品导出：规格名/值按 tier_index 解析', rows[0].tierName1 === '颜色' && rows[0].tierValue1 === '红'
      && rows[0].tierName2 === '尺寸' && rows[0].tierValue2 === 'M'
      && rows[1].tierValue1 === '蓝' && rows[1].tierValue2 === 'S', JSON.stringify(rows));
    t('商品导出：规格值图片链接按市场输出直链', rows[0].tierImage1 === 'https://down-ph.img.susercontent.com/sg-11134201-c1'
      && rows[0].tierImage2 === 'https://down-ph.img.susercontent.com/sg-11134201-s2', JSON.stringify(rows));
    t('商品导出：SKU 图片优先列表 model.image（卖家中心权威值）', rows[0].skuImage === 'https://down-ph.img.susercontent.com/cn-11134207-m1'
      && rows[1].skuImage === 'https://down-ph.img.susercontent.com/cn-11134207-m2', JSON.stringify(rows));

    // 实测踩坑场景（item 18173017892）：详情 tier_variation.images 与列表 model.image 不一致时，
    // SKU 图片必须取 model.image，不能取规格值图片
    const staleDetail = {
      tier_variation: [
        { name: 'Color', options: ['Multicolor'], images: ['cn-11134207-7r98o-lzolfa67g04i02'] },
      ],
      model_list: [{ id: 49252964462, name: 'Multicolor,216LED(5M*0.7M) [Plug]', tier_index: [0], sku: 'A225E' }],
    };
    const listWithModelImage = {
      id: 18173017892, name: '测试商品2', status: 1,
      model_list: [{ id: 49252964462, name: 'Multicolor,216LED(5M*0.7M) [Plug]', tier_index: [0], image: 'cn-11134207-820l4-monpa1s8re31ea' }],
    };
    const rows3 = buildRows(listWithModelImage, staleDetail, '557630453', 'ph');
    t('商品导出：tier 图片过期时 SKU 图片仍取 model.image', rows3.length === 1
      && rows3[0].tierImage1 === 'https://down-ph.img.susercontent.com/cn-11134207-7r98o-lzolfa67g04i02'
      && rows3[0].skuImage === 'https://down-ph.img.susercontent.com/cn-11134207-820l4-monpa1s8re31ea', JSON.stringify(rows3[0]));

    // 无详情降级：规格名留空，SKU 图片兜底列表 model.image
    const rows2 = buildRows(product, null, '557630453', 'ph');
    t('商品导出：无详情时规格名留空、SKU 图片兜底列表 image', rows2.length === 2
      && rows2[0].tierName1 === '' && rows2[0].tierValue1 === ''
      && rows2[0].skuImage === 'https://down-ph.img.susercontent.com/cn-11134207-m1', JSON.stringify(rows2[0]));

    // 表头与行单元格对齐
    const maxTiers = 2;
    t('商品导出：表头与行单元格列数一致', headerCells(maxTiers).length === rowToCells(rows[0], maxTiers).length
      && headerCells(maxTiers).includes('SKU图片链接') && headerCells(maxTiers).includes('规格2图片链接'));
    t('商品导出：optionTextOf/optionImageIdOf 兼容字符串与对象选项',
      optionTextOf('红') === '红' && optionTextOf({ option: '蓝' }) === '蓝'
      && optionImageIdOf({ image_id: 'x1' }, null, 0) === 'x1'
      && optionImageIdOf('红', { images: ['i1'] }, 0) === 'i1');
    t('商品导出：tierTableOf 汇总规格名/值/图', (() => {
      const tb = tierTableOf(detail);
      return tb.count === 2 && tb.name(1) === '尺寸' && tb.option(1, 0) === 'S' && tb.imageId(1, 1) === 'sg-11134201-s2';
    })());
  }

  // ===== 全局：路由分发兜底（lib/http-utils.createDispatcher） =====
  {
    // 最小 res 双桩：记录 writeHead / end，模拟 headersSent
    function fakeRes() {
      const r = { headersSent: false, status: 0, body: '' };
      r.writeHead = (s) => { r.headersSent = true; r.status = s; };
      r.end = (b) => { r.body = b || ''; };
      return r;
    }
    const url = new URL('http://127.0.0.1/x');
    const settle = () => new Promise((r) => setTimeout(r, 10)); // 等待 Promise 微任务链

    t('分发：未命中路由返回 false', createDispatcher([])({ method: 'GET' }, fakeRes(), url) === false);

    const resSync = fakeRes();
    const hitSync = createDispatcher([{ m: 'GET', p: '/x', fn: () => { throw new Error('boom-sync'); } }])({ method: 'GET' }, resSync, url);
    await settle();
    const jSync = JSON.parse(resSync.body);
    t('分发：同步抛错兜底 500', hitSync === true && resSync.status === 500 && jSync.ok === false && resSync.body.includes('服务内部错误'), resSync.body);

    const resAsync = fakeRes();
    const hitAsync = createDispatcher([{ m: 'GET', p: '/x', fn: async () => { throw new Error('boom-async'); } }])({ method: 'GET' }, resAsync, url);
    await settle();
    t('分发：异步 reject 兜底 500', hitAsync === true && resAsync.status === 500 && JSON.parse(resAsync.body).ok === false, resAsync.body);

    // 已写响应头（模拟 SSE 流）后再抛错：不二次写响应，仅走 onError
    const resSse = fakeRes();
    let reported = null;
    const onError = (e, m, p) => { reported = { msg: e.message, m, p }; };
    const routesSse = [{ m: 'GET', p: '/x', fn: (req, res) => { res.writeHead(200); res.end(''); throw new Error('boom-sse'); } }];
    createDispatcher(routesSse, onError)({ method: 'GET' }, resSse, url);
    await settle();
    t('分发：已写响应头不二次响应（SSE）', resSse.status === 200 && resSse.body === '');
    t('分发：onError 上报方法与路径', reported && reported.msg === 'boom-sse' && reported.m === 'GET' && reported.p === '/x', JSON.stringify(reported));
  }
}

module.exports = { run };