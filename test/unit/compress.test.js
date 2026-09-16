'use strict';
// 单元测试：视频压缩的纯函数（压缩计划 / 码率与滤镜计算 / 命令行拼装 / 产物命名）
// 与递归扫描的过滤规则。不依赖本机是否装了 ffmpeg（不触发任何子进程）。
const fs = require('fs');
const os = require('os');
const path = require('path');
const { t } = require('../helpers');
const {
  normalizeOpts, planFor, lowerBitrate, buildArgs, atempoChain, scaleFilterFor, MB,
} = require('../../server/compress/plan');
const { scanVideos, isOwnOutput } = require('../../server/compress/scan');
const { outputName } = require('../../server/compress/run');
const { DEFAULTS, MIN_VIDEO_KBPS } = require('../../server/compress/constants');

/** 造一个「超标」源文件信息：100MB / 180 秒 / 1080p 带音轨 */
const bigInfo = {
  size: 100 * MB, duration: 180, width: 1920, height: 1080, hasAudio: true,
};

async function run() {
  // ===== 选项归一化 =====
  {
    const d = normalizeOpts();
    t('normalizeOpts 缺省取 DEFAULTS', d.maxMB === DEFAULTS.maxMB && d.maxSeconds === DEFAULTS.maxSeconds
      && d.maxLongSide === DEFAULTS.maxLongSide);
    const n = normalizeOpts({ maxMB: 'abc', maxSeconds: null, maxLongSide: -5 });
    t('normalizeOpts 非法值回落默认',
      n.maxMB === DEFAULTS.maxMB && n.maxSeconds === DEFAULTS.maxSeconds
      && n.maxLongSide === 0, JSON.stringify(n));
    t('normalizeOpts 把 null / 空串当未填写（否则会被夹到下限，maxSeconds 变 1 秒）',
      normalizeOpts({ maxSeconds: null }).maxSeconds === DEFAULTS.maxSeconds
      && normalizeOpts({ maxMB: '' }).maxMB === DEFAULTS.maxMB
      && normalizeOpts({ maxSeconds: 0 }).maxSeconds === 1, JSON.stringify(normalizeOpts({ maxSeconds: null })));
    const c = normalizeOpts({ maxMB: 99999, maxSeconds: 0, maxLongSide: 99999 });
    t('normalizeOpts 上下限收敛', c.maxMB === 4096 && c.maxSeconds === 1 && c.maxLongSide === 7680, JSON.stringify(c));
    t('normalizeOpts 不再产出 overMode（超时长一律加速）', !('overMode' in d));
  }

  // ===== 是否需要处理 =====
  {
    const opts = normalizeOpts({});
    t('planFor 体积与时长都达标 → 跳过',
      planFor({ size: 10 * MB, duration: 30, width: 1280, height: 720, hasAudio: true }, opts).skip === true);
    t('planFor 只有体积超标 → 不跳过',
      planFor({ size: 100 * MB, duration: 30, width: 1280, height: 720, hasAudio: true }, opts).skip === false);
    t('planFor 只有时长超标 → 不跳过',
      planFor({ size: 10 * MB, duration: 300, width: 1280, height: 720, hasAudio: true }, opts).skip === false);
    const edge = planFor({ size: 30 * MB, duration: 60, width: 1280, height: 720, hasAudio: true }, opts);
    t('planFor 正好等于上限 → 视为达标（含边界）', edge.skip === true);
  }

  // ===== 码率计算（超时长一律整段加速）=====
  {
    const opts = normalizeOpts({ maxMB: 30, maxSeconds: 60, maxLongSide: 1280 });
    const p = planFor(bigInfo, opts);
    t('planFor 超时长：整段加速到上限（不截取）',
      p.outDuration === 60 && Math.abs(p.speedRatio - 3) < 1e-9, `dur=${p.outDuration} ratio=${p.speedRatio}`);
    t('planFor 加速时带音频变速滤镜', p.audioFilter === 'atempo=2,atempo=1.5000', p.audioFilter);
    // 目标 30MB × 0.96 余量 × 8 ÷ 60 秒 ≈ 4026kbps，减去 96k 音频 ≈ 3930
    t('planFor 视频码率按预算算出（30MB/60s 约 3930kbps）',
      p.videoKbps > 3850 && p.videoKbps < 3950, String(p.videoKbps));
    t('planFor 1080p 缩到长边 1280', p.scaleFilter === 'scale=1280:-2', p.scaleFilter);
    t('planFor 标记超标维度', p.overSize === true && p.overTime === true);

    const q = planFor(Object.assign({}, bigInfo, { hasAudio: false }), opts);
    t('planFor 无音轨时不扣音频码率', q.videoKbps > p.videoKbps, `${q.videoKbps} vs ${p.videoKbps}`);
    t('planFor 码率不低于下限',
      planFor({ size: 900 * MB, duration: 3600, width: 1920, height: 1080, hasAudio: true },
        normalizeOpts({ maxMB: 1, maxSeconds: 3600 })).videoKbps >= MIN_VIDEO_KBPS);

    const short = planFor({ size: 100 * MB, duration: 40, width: 1920, height: 1080, hasAudio: true }, opts);
    t('planFor 时长本身没超则不加速（只压体积）',
      short.speedRatio === 1 && short.audioFilter === '' && short.outDuration === 40);

    // 只超时长、体积远低于上限：必须沿用源码率，不能按体积上限反推——否则会得到一个
    // 远高于源码率的码率，重编码后体积暴涨（3MB/15s 压到 8s 曾得到 23MB）。
    const light = { size: 3 * MB, duration: 15, width: 1280, height: 720, hasAudio: true };
    const lite = planFor(light, normalizeOpts({ maxMB: 30, maxSeconds: 8, maxLongSide: 1280 }));
    const srcKbps = (light.size * 8) / light.duration / 1000; // ≈1678
    t('planFor 只超时长时码率不超过源码率（不再越压越大）',
      lite.videoKbps < srcKbps && lite.videoKbps > srcKbps - 200, `${lite.videoKbps} vs 源码率 ${srcKbps}`);
    t('planFor 只超时长时不会把码率抬到「按体积上限反推」的 3 万 kbps',
      lite.outKbps < 2000 && lite.outKbps > 1000, String(lite.outKbps));

    // 超长低码率视频同理：源码率只有两百多 kbps 时不能被抬到预算的 4000kbps
    const longLow = planFor({ size: 100 * MB, duration: 3600, width: 1920, height: 1080, hasAudio: true },
      normalizeOpts({ maxMB: 30, maxSeconds: 60 }));
    t('planFor 超长低码率视频的码率不被抬高（落到下限）',
      longLow.videoKbps === MIN_VIDEO_KBPS, String(longLow.videoKbps));
  }

  // ===== atempo / scale 纯函数 =====
  {
    t('atempoChain 1.5 倍单段', atempoChain(1.5) === 'atempo=1.5000');
    t('atempoChain 4 倍拆两段', atempoChain(4) === 'atempo=2,atempo=2.0000', atempoChain(4));
    t('atempoChain 8 倍拆三段', atempoChain(8) === 'atempo=2,atempo=2,atempo=2.0000', atempoChain(8));
    t('scaleFilterFor 横屏按宽缩', scaleFilterFor(1920, 1080, 1280) === 'scale=1280:-2');
    t('scaleFilterFor 竖屏按高缩', scaleFilterFor(1080, 1920, 1280) === 'scale=-2:1280');
    t('scaleFilterFor 未超上限不缩放', scaleFilterFor(640, 480, 1280) === '');
    t('scaleFilterFor 关掉缩放（0）恒为空', scaleFilterFor(3840, 2160, 0) === '');
  }

  // ===== 降码率重试 =====
  {
    const p = planFor(bigInfo, normalizeOpts({}));
    const low = lowerBitrate(p);
    t('lowerBitrate 按系数下调', low.videoKbps < p.videoKbps, `${low.videoKbps} vs ${p.videoKbps}`);
    t('lowerBitrate 不改时长与滤镜', low.outDuration === p.outDuration && low.scaleFilter === p.scaleFilter);
    t('lowerBitrate 不会低于下限', lowerBitrate({ videoKbps: MIN_VIDEO_KBPS }).videoKbps === MIN_VIDEO_KBPS);
  }

  // ===== 命令行拼装 =====
  {
    const plan = planFor(bigInfo, normalizeOpts({})); // 180s → 3× 加速到 60s
    const args = buildArgs({ input: 'in.mp4', output: 'out.mp4', plan });
    const has = (a) => args.includes(a);
    t('buildArgs 输出时长截到上限（-t 60）', has('-t') && args[args.indexOf('-t') + 1] === '60', args.join(' '));
    t('buildArgs 显式指定主视频轨（不误取封面图）', has('-map') && args[args.indexOf('-map') + 1] === '0:v:0');
    t('buildArgs 有音轨时映射音频轨', args.filter((a) => a === '0:a:0').length === 1);
    t('buildArgs 用 libx264 + faststart', has('libx264') && has('+faststart'));
    t('buildArgs 码率与 maxrate/bufsize 成套给出',
      args.includes('-b:v') && args.includes('-maxrate') && args.includes('-bufsize'));
    t('buildArgs 变速与缩放滤镜同时给出',
      has('-vf') && args[args.indexOf('-vf') + 1] === 'setpts=PTS/3.000000,scale=1280:-2',
      args[args.indexOf('-vf') + 1]);
    t('buildArgs 变速模式同时给 atempo',
      args.includes('-af') && args[args.indexOf('-af') + 1] === 'atempo=2,atempo=1.5000', args.join(' '));
    t('buildArgs 产物路径在最后（ffmpeg 要求）', args[args.length - 1] === 'out.mp4');

    const noAudio = buildArgs({ input: 'i', output: 'o', plan: planFor(Object.assign({}, bigInfo, { hasAudio: false }), normalizeOpts({})) });
    t('buildArgs 无音轨时用 -an', noAudio.includes('-an') && !noAudio.includes('0:a:0'));
  }

  // ===== 产物命名 =====
  {
    t('outputName 加 -compressed 后缀并统一转 mp4',
      outputName('a/b/视频名.mov') === '视频名-compressed.mp4', outputName('a/b/视频名.mov'));
    t('isOwnOutput 识别本次产物', isOwnOutput('x-compressed.mp4') === true);
    t('isOwnOutput 兼容旧版下划线产物', isOwnOutput('x_compressed.mp4') === true);
    t('isOwnOutput 不误判普通文件', isOwnOutput('x.mp4') === false && isOwnOutput('compressed.mp4') === false);
  }

  // ===== 递归扫描 =====
  {
    const dir = path.join(os.tmpdir(), `kp_compress_scan_${process.pid}_${Date.now()}`);
    const sub = path.join(dir, 'sub', 'deep');
    const own = path.join(dir, 'compressed');
    const hidden = path.join(dir, '.hidden');
    for (const d of [dir, sub, own, hidden]) fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(dir, 'a.mp4'), 'x');
    fs.writeFileSync(path.join(dir, 'readme.txt'), 'x');
    fs.writeFileSync(path.join(sub, 'b.MOV'), 'x');
    fs.writeFileSync(path.join(sub, 'c.mkv'), 'x');
    fs.writeFileSync(path.join(own, 'd.mp4'), 'x');       // 旧产物目录：跳过
    fs.writeFileSync(path.join(hidden, 'e.mp4'), 'x');    // 隐藏目录：跳过
    fs.writeFileSync(path.join(dir, 'f-compressed.mp4'), 'x'); // 本次产物：跳过
    fs.writeFileSync(path.join(dir, 'g_compressed.mp4'), 'x'); // 旧版产物：跳过
    fs.writeFileSync(path.join(dir, '.kp-compress-tmp-1.mp4'), 'x'); // 覆盖模式临时文件：跳过
    fs.writeFileSync(path.join(dir, 'empty.mp4'), '');    // 0 字节：跳过

    try {
      const r = scanVideos(dir);
      const rels = r.files.map((f) => f.rel).sort();
      t('scanVideos 递归找出视频且大小写扩展名都认',
        rels.join(',') === 'a.mp4,sub/deep/b.MOV,sub/deep/c.mkv', rels.join(','));
      t('scanVideos 跳过 compressed/ 、隐藏目录与上次产物', !rels.some((x) => x.includes('compressed') || x.includes('hidden')));
      t('scanVideos 跳过 0 字节文件', !rels.includes('empty.mp4'));
      t('scanVideos 返回相对路径用正斜杠（跨平台一致）', rels.every((x) => !x.includes('\\')));
      t('scanVideos 汇总总大小', r.totalSize === 3 && r.truncated === false, String(r.totalSize));
    } finally {
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* 忽略 */ }
    }

    let threw = '';
    try { scanVideos(path.join(os.tmpdir(), 'kp_compress_not_exist_xyz')); } catch (e) { threw = e.message; }
    t('scanVideos 目录不存在时给出可读原因（不漏 Node 原始 ENOENT）',
      threw.includes('文件夹不存在或无法访问') && !threw.includes('ENOENT'), threw);

    const filePath = path.join(os.tmpdir(), `kp_compress_is_file_${process.pid}.mp4`);
    fs.writeFileSync(filePath, 'x');
    let threw2 = '';
    try { scanVideos(filePath); } catch (e) { threw2 = e.message; }
    finally { try { fs.rmSync(filePath, { force: true }); } catch { /* 忽略 */ } }
    t('scanVideos 传文件路径时明确报「不是文件夹」', threw2.includes('不是文件夹'), threw2);
  }
}

module.exports = { run };
