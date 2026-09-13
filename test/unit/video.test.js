'use strict';
// 单元测试：视频上传工具（video-utils 纯函数 / 出站请求重试语义 / 任务取消与 SSE 收尾）。
const os = require('os');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { t } = require('../helpers');
const { box, mvhdBody, tkhdBody, buildMp4, buildMp4TailMoov, makeAuth } = require('./fixtures');
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
  findMoovInTail,
  validateUploadRow,
} = require('../../server/lib/video-utils');
const videoRequest = require('../../server/video/request');
const video = require('../../server/video');

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

  // ===== probeVideoFile：非 faststart（moov 在尾部）布局必须能探测到 =====
  // 回归：尾采样窗口起点与 box 边界不对齐，旧实现按 box 头顺序解析 → >512KB 且 moov 在尾的文件
  // 恒返回 0x0/0ms，导致 video/create 提交 width/height/duration 全 0。
  {
    const tail = path.join(os.tmpdir(), `kp_probe_tail_${Date.now()}.mp4`);
    fs.writeFileSync(tail, buildMp4TailMoov(600 * 1024)); // 总大小 ≈ 600KB > 512KB 采样窗口
    try {
      const r = probeVideoFile(tail);
      t('probeVideoFile 尾置 moov（>512KB）解析出宽高', r.width === 1280 && r.height === 720, JSON.stringify(r));
      t('probeVideoFile 尾置 moov（>512KB）解析出时长', r.duration === 5000, JSON.stringify(r));
      t('probeVideoFile 尾置 moov 不再返回全 0（回归旧 bug）', r.width !== 0 && r.duration !== 0);
    } finally {
      fs.unlinkSync(tail);
    }
    // moov 之后还有小 box（如 free）：moov 不恰好收尾，走兜底分支也要命中
    const tailFree = path.join(os.tmpdir(), `kp_probe_tail_free_${Date.now()}.mp4`);
    fs.writeFileSync(tailFree, buildMp4TailMoov(600 * 1024, box('free', Buffer.alloc(16))));
    try {
      t('probeVideoFile 尾置 moov 后跟 free box 仍能解析', probeVideoFile(tailFree).width === 1280, JSON.stringify(probeVideoFile(tailFree)));
    } finally {
      fs.unlinkSync(tailFree);
    }
    // >512KB 但整份文件里没有 moov → 返回 0，不抛错
    const noMoov = path.join(os.tmpdir(), `kp_probe_nomoov_${Date.now()}.mp4`);
    fs.writeFileSync(noMoov, Buffer.concat([box('ftyp', Buffer.from('isom')), box('mdat', Buffer.alloc(600 * 1024))]));
    try {
      t('probeVideoFile 大文件无 moov 返回 0 不抛错', probeVideoFile(noMoov).width === 0);
    } finally {
      fs.unlinkSync(noMoov);
    }
    // 回归：moov 本身很大（长视频帧索引多，moov 可达数 MB）——'moov' 签名距 EOF 超过 512KB
    // 采样窗，旧逻辑小窗搜不到签名 → 返回全 0，发布接口拿到 duration=0。加宽窗后必须命中
    {
      const bigMoov = box('moov', Buffer.concat([
        box('mvhd', mvhdBody(1000, 5000)),
        box('trak', box('tkhd', tkhdBody(1280, 720))),
        box('free', Buffer.alloc(700 * 1024)), // 把 moov 撑到 ~700KB
      ]));
      const bigTail = path.join(os.tmpdir(), `kp_probe_big_moov_${Date.now()}.mp4`);
      fs.writeFileSync(bigTail, Buffer.concat([box('ftyp', Buffer.from('isom')), box('mdat', Buffer.alloc(64 * 1024)), bigMoov]));
      try {
        const r = probeVideoFile(bigTail);
        t('probeVideoFile 大 moov（签名距 EOF>512KB）解析出宽高', r.width === 1280 && r.height === 720, JSON.stringify({ width: r.width, height: r.height }));
        t('probeVideoFile 大 moov 解析出时长', r.duration === 5000, `duration=${r.duration}`);
      } finally {
        fs.unlinkSync(bigTail);
      }
    }
    // 窗口起点不对齐（前面 7 字节杂数据）：仍能由 'moov' 签名回推 box 起点
    t('findMoovInTail 窗口起点不对齐时仍能回推 box 起点', (() => {
      const buf = Buffer.concat([Buffer.alloc(7), box('moov', mvhdBody(1000, 5000))]);
      const hit = findMoovInTail(buf, 0, buf.length);
      return !!hit && hit.end === buf.length && hit.body === 7 + 8;
    })());
    // size 越界（声明 100 字节但窗口只有 16 字节）不误判
    t('findMoovInTail 越界 size 不误判', (() => {
      const b = Buffer.from('00000000646d6f6f7600000000', 'hex'); // size=100 的 moov，仅 12 字节
      return findMoovInTail(b, 0, b.length) === null;
    })());
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
    // 0 字节文件 / 目录：必须给出可读原因，而不是让分片读取抛 ERR_OUT_OF_RANGE
    const empty = path.join(os.tmpdir(), `kp_tools_empty_${Date.now()}.mp4`);
    fs.writeFileSync(empty, '');
    try {
      t('validateUploadRow 空文件（0 字节）报错并说明原因', validateUploadRow({ path: empty }).includes('0 字节'), validateUploadRow({ path: empty }));
    } finally {
      fs.unlinkSync(empty);
    }
    const dir = path.join(os.tmpdir(), `kp_tools_dir_${Date.now()}`);
    fs.mkdirSync(dir, { recursive: true });
    try {
      t('validateUploadRow 目录路径报错', validateUploadRow({ path: dir }).includes('文件夹'), validateUploadRow({ path: dir }));
    } finally {
      fs.rmdirSync(dir);
    }
  }

  // ===== 视频出站请求：分片区间校验 + 非幂等写操作不重放 =====
  {
    const { isSafeToRetryNonIdempotent } = videoRequest._test;
    t('非幂等重试：连接未建立类错误可重试',
      isSafeToRetryNonIdempotent({ code: 'ECONNREFUSED' }) && isSafeToRetryNonIdempotent({ code: 'ENOTFOUND' }) && isSafeToRetryNonIdempotent({ code: 'EAI_AGAIN' }));
    t('非幂等重试：超时 / 5xx / 空值不可重试',
      !isSafeToRetryNonIdempotent(new Error('请求超时')) && !isSafeToRetryNonIdempotent(new Error('上游返回 HTTP 502')) && !isSafeToRetryNonIdempotent(null));

    // 空文件的分片区间：给出可读错误，而不是 createReadStream 的 ERR_OUT_OF_RANGE
    let rcErr = null;
    try { await videoRequest.readChunk(path.join(os.tmpdir(), 'kp_no_such_file.mp4'), 0, 0); } catch (e) { rcErr = e; }
    t('readChunk：空区间给出可读原因而非 ERR_OUT_OF_RANGE',
      !!rcErr && rcErr.message.includes('分片范围无效') && !/ERR_OUT_OF_RANGE/.test(rcErr.message), String(rcErr));

    const httpMod = require('http');
    // 非幂等：全是 5xx 也只请求一次（服务端可能已写入，重放会造成重复合并/重复发布）
    let hits = 0;
    const srv = httpMod.createServer((req, res) => { hits += 1; res.statusCode = 500; res.end('boom'); });
    await new Promise((r) => srv.listen(0, '127.0.0.1', r));
    try {
      let err = null;
      try { await videoRequest.call({ method: 'POST', url: `http://127.0.0.1:${srv.address().port}/x`, body: '{}', idempotent: false }); } catch (e) { err = e; }
      t('非幂等：5xx 只请求一次（不重放）', hits === 1 && !!err, `hits=${hits} err=${err && err.message}`);
    } finally { srv.close(); }

    // 对照：幂等请求（默认）仍按 attempts 重试
    let hits2 = 0;
    const srv2 = httpMod.createServer((req, res) => {
      hits2 += 1;
      if (hits2 === 1) { res.statusCode = 500; res.end('boom'); return; }
      res.statusCode = 200;
      res.end('{}');
    });
    await new Promise((r) => srv2.listen(0, '127.0.0.1', r));
    try {
      const r = await videoRequest.call({ method: 'GET', url: `http://127.0.0.1:${srv2.address().port}/x`, retries: 1 });
      t('幂等（默认）：5xx 会重试一次后成功', hits2 === 2 && r.status === 200, `hits=${hits2}`);
    } catch (e) {
      t('幂等（默认）：5xx 会重试一次后成功', false, String(e));
    } finally { srv2.close(); }
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

  // ===== SSE：任务收尾释放连接 / 迟到连接遇终态即关闭 =====
  {
    const { clients, finishJob, jobEvents } = video._test;

    // 收尾时应主动 end 掉该任务的 SSE 连接（而不是只从 clients 里删掉，留下悬挂连接）
    const jobA = 'sse-finish-a';
    const ended = [];
    clients.set(jobA, new Set([
      { writableEnded: false, end() { this.writableEnded = true; ended.push('alive'); } },
      { writableEnded: true, end() { ended.push('already-ended'); } },
    ]));
    finishJob(jobA);
    t('收尾：finishJob 关闭未结束的 SSE 连接并清理 clients',
      ended.length === 1 && ended[0] === 'alive' && !clients.has(jobA), JSON.stringify(ended));

    // 迟到连接回放：以 cancelled / fatal 结束的任务同样要直接关闭（旧实现只认 finished → 连接悬挂）
    const routes = {};
    video.register({ get: (p, fn) => { routes[p] = fn; }, post: () => {} });
    const onEvents = routes['/api/events'];
    t('SSE：/api/events 路由已注册', typeof onEvents === 'function');
    for (const terminal of ['cancelled', 'fatal', 'finished']) {
      const jobId = `sse-replay-${terminal}`;
      jobEvents.set(jobId, [{ type: 'connected' }, { type: terminal, error: 'x' }]);
      const res = {
        writableEnded: false, headersSent: false, chunks: [],
        writeHead() { this.headersSent = true; return this; },
        write(c) { this.chunks.push(c); return true; },
        end() { this.writableEnded = true; },
      };
      onEvents({ on() {} }, res, new URL(`http://127.0.0.1/api/events?jobId=${jobId}`));
      t(`SSE：迟到连接回放 ${terminal} 后关闭连接且不挂入 clients`,
        res.writableEnded === true && !clients.has(jobId), `ended=${res.writableEnded} inClients=${clients.has(jobId)}`);
      jobEvents.delete(jobId);
    }
    // 进行中的任务：回放后保持连接并纳入 clients
    const liveId = 'sse-replay-live';
    jobEvents.set(liveId, [{ type: 'connected' }, { type: 'step', step: 'read', msg: 'x' }]);
    const liveRes = {
      writableEnded: false, writeHead() {}, write() { return true; }, end() { this.writableEnded = true; },
    };
    onEvents({ on() {} }, liveRes, new URL(`http://127.0.0.1/api/events?jobId=${liveId}`));
    t('SSE：未结束任务的迟到连接保持打开并纳入 clients',
      !liveRes.writableEnded && !!(clients.get(liveId) && clients.get(liveId).has(liveRes)));
    finishJob(liveId);
    jobEvents.delete(liveId);
  }
}

module.exports = { run };
