'use strict';
// 单元测试共享夹具：合成可被 probeVideo 解析的 MP4（仅盒结构，无真实媒体数据），
// 以及构造 Authorization（base64("50007225:<jwt>")）。

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
// 非 faststart 布局：ftyp + mdat(填充) + moov，moov 落在文件末尾（ffmpeg 默认即此布局）。
// 文件必须 > 512KB（探测采样窗口）才能走到尾采样分支。
function buildMp4TailMoov(padSize, trailingBox) {
  const mvhd = box('mvhd', mvhdBody(1000, 5000));
  const tkhd = box('tkhd', tkhdBody(1280, 720));
  const trak = box('trak', tkhd);
  const moov = box('moov', Buffer.concat([mvhd, trak]));
  const parts = [box('ftyp', Buffer.from('isom')), box('mdat', Buffer.alloc(padSize)), moov];
  if (trailingBox) parts.push(trailingBox);
  return Buffer.concat(parts);
}
function b64url(str) {
  return Buffer.from(str, 'utf8').toString('base64url');
}
function makeAuth(exp) {
  const jwt = `${b64url('{"alg":"HS256"}')}.${b64url(JSON.stringify({ exp }))}.sig`;
  return Buffer.from('50007225:' + jwt).toString('base64');
}

module.exports = { box, mvhdBody, tkhdBody, buildMp4, buildMp4TailMoov, b64url, makeAuth };
