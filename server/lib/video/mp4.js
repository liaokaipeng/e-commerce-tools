'use strict';
/** MP4 容器解析：定位 moov box 并解析宽高/时长（不依赖系统 ffprobe，解析失败返回全 0，不影响上传） */
const fs = require('fs');

// 在 buffer 的 [start, end) 范围顺序扫描，返回第一个 type 匹配的 box 位置 { body, end }，找不到返回 null
function findBox(buf, start, end, type) {
  let p = start;
  const e = end;
  while (p + 8 <= e) {
    let size = buf.readUInt32BE(p);
    const t = buf.toString('latin1', p + 4, p + 8);
    let body = p + 8;
    if (size === 1) { if (p + 16 > e) return null; size = Number(buf.readBigUInt64BE(p + 8)); body = p + 16; }
    else if (size === 0) { size = e - p; }
    if (size < 8 || p + size > e) return null;
    if (t === type) return { body, end: p + size };
    p += size;
  }
  return null;
}

// 解析 moov box（完整内容）里的 mvhd / tkhd，取宽高与时长；解析不出返回 0
function parseMoov(moov) {
  const r = { width: 0, height: 0, duration: 0 };
  let p = 0;
  while (p + 8 <= moov.length) {
    let size = moov.readUInt32BE(p);
    const type = moov.toString('latin1', p + 4, p + 8);
    let body = p + 8;
    if (size === 1) { if (p + 16 > moov.length) break; size = Number(moov.readBigUInt64BE(p + 8)); body = p + 16; }
    else if (size === 0) { size = moov.length - p; }
    if (size < 8 || p + size > moov.length) break;
    if (type === 'mvhd') {
      const ver = moov.readUInt8(body);
      let ts, dur;
      if (ver === 1) { ts = moov.readUInt32BE(body + 4 + 8 + 8); dur = Number(moov.readBigUInt64BE(body + 4 + 8 + 8 + 4)); }
      else { ts = moov.readUInt32BE(body + 4 + 4 + 4); dur = moov.readUInt32BE(body + 4 + 4 + 4 + 4); }
      if (ts > 0) r.duration = Math.round((dur / ts) * 1000);
    } else if (type === 'trak' && r.width === 0) {
      // tkhd 是 trak 的直接子 box，扫描一层即可
      const tEnd = p + size;
      let q = body;
      while (q + 8 <= tEnd) {
        let sz2 = moov.readUInt32BE(q);
        const t2 = moov.toString('latin1', q + 4, q + 8);
        let b2 = q + 8;
        if (sz2 === 1) { if (q + 16 > tEnd) break; sz2 = Number(moov.readBigUInt64BE(q + 8)); b2 = q + 16; }
        else if (sz2 === 0) { sz2 = tEnd - q; }
        if (sz2 < 8 || q + sz2 > tEnd) break;
        if (t2 === 'tkhd') {
          const ver = moov.readUInt8(b2);
          const off = ver === 1 ? b2 + 4 + 32 + 16 + 36 : b2 + 4 + 20 + 16 + 36;
          r.width = Math.round(moov.readUInt32BE(off) / 65536);
          r.height = Math.round(moov.readUInt32BE(off + 4) / 65536);
        }
        q += sz2;
      }
    }
    p += size;
  }
  return r;
}

/**
 * 从 MP4 buffer 解析宽高/时长（不依赖系统 ffprobe；解析失败返回全 0，不影响上传）。
 */
function probeVideo(buf) {
  const moov = findBox(buf, 0, buf.length, 'moov');
  return moov ? parseMoov(buf.subarray(moov.body, moov.end)) : { width: 0, height: 0, duration: 0 };
}

const PROBE_SAMPLE = 512 * 1024; // 头/尾采样窗口
const PROBE_MAX_MOOV = 8 * 1024 * 1024; // moov 超过该大小跳过探测（罕见，避免读大块）
const MOOV_SIG = Buffer.from('moov', 'latin1');

/**
 * 在尾部采样窗口内定位 moov box（非 faststart 布局：moov 在文件末尾）。
 * 窗口起点不保证与 box 边界对齐，不能像 findBox 那样按 box 头顺序解析，
 * 改为直接反向搜索 'moov' 签名，再由签名前 4 字节的 size 回推 box 起止。
 * 命中条件：size 合法且 box 不越界；优先取「恰好收尾」的那个（末尾布局最可靠），
 * 否则退回第一个合法的（容忍 moov 之后还有 free 等小 box）。
 * @param {Buffer} tail 尾部窗口内容
 * @param {number} tailStart 窗口在文件中的起始偏移
 * @param {number} fileSize 文件总大小
 * @returns {{body:number,end:number}|null}
 */
function findMoovInTail(tail, tailStart, fileSize) {
  let fallback = null;
  let idx = tail.lastIndexOf(MOOV_SIG);
  while (idx >= 4) {
    const boxStart = idx - 4;
    const size = tail.readUInt32BE(boxStart);
    const absStart = tailStart + boxStart;
    if (size >= 8 && size <= PROBE_MAX_MOOV && absStart + size <= fileSize) {
      const box = { body: absStart + 8, end: absStart + size };
      if (absStart + size === fileSize) return box;
      if (!fallback) fallback = box;
    }
    idx = tail.lastIndexOf(MOOV_SIG, idx - 1);
  }
  return fallback;
}

/**
 * 从 MP4 文件解析宽高/时长（不整文件加载）：采样文件头尾各 512KB 定位 moov，
 * 再按偏移只读 moov 完整内容解析。faststart 的 moov 在头部、非 faststart 的在尾部。
 * 512KB 采样失败再加宽到 PROBE_MAX_MOOV 上限重试一次——长视频的 moov（帧索引多）
 * 本身可达数 MB，'moov' 签名会落在 512KB 窗口外，只用小窗口会把「有 moov」
 * 误判为「解析不出」→ 元信息全 0 照样提交给发布接口。
 */
function probeVideoFile(filePath) {
  const fd = fs.openSync(filePath, 'r');
  try {
    const size = fs.fstatSync(fd).size;
    if (size < 8) return { width: 0, height: 0, duration: 0 };
    const wideLen = Math.min(PROBE_MAX_MOOV + PROBE_SAMPLE, size);
    const headLen = Math.min(PROBE_SAMPLE, size);
    const head = Buffer.alloc(headLen);
    fs.readSync(fd, head, 0, headLen, 0);
    let moov = findBox(head, 0, headLen, 'moov');
    if (!moov && wideLen > headLen) {
      const bigHead = Buffer.alloc(wideLen);
      fs.readSync(fd, bigHead, 0, wideLen, 0);
      moov = findBox(bigHead, 0, wideLen, 'moov');
    }
    if (!moov && size > PROBE_SAMPLE) {
      const tailLen = Math.min(PROBE_SAMPLE, size);
      const tail = Buffer.alloc(tailLen);
      fs.readSync(fd, tail, 0, tailLen, size - tailLen);
      moov = findMoovInTail(tail, size - tailLen, size);
      if (!moov && wideLen > tailLen) {
        const bigTail = Buffer.alloc(wideLen);
        fs.readSync(fd, bigTail, 0, wideLen, size - wideLen);
        moov = findMoovInTail(bigTail, size - wideLen, size);
      }
    }
    if (!moov) return { width: 0, height: 0, duration: 0 };
    const moovSize = moov.end - moov.body;
    if (moovSize <= 0 || moovSize > PROBE_MAX_MOOV) return { width: 0, height: 0, duration: 0 };
    const moovBuf = Buffer.alloc(moovSize);
    fs.readSync(fd, moovBuf, 0, moovSize, moov.body);
    return parseMoov(moovBuf);
  } catch (e) { /* 解析失败保持 0，不影响上传 */ }
  finally { fs.closeSync(fd); }
  return { width: 0, height: 0, duration: 0 };
}

module.exports = {
  probeVideo,
  probeVideoFile,
  findMoovInTail,
};
