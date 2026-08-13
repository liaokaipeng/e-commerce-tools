'use strict';
// 单元测试：后端纯函数（无网络依赖、不启动服务）。
// 覆盖：视频上传工具（哈希/etag/AES 解密/auth 解析/SigV4/item 收集/MP4 探测/行校验）、
//       TikTok 链接处理与错误分类、竞价金额换算。
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
}

module.exports = { run };