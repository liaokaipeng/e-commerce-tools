'use strict';
/**
 * 视频上传通用纯函数（门面，无网络依赖，可独立单元测试）
 *
 * 本文件曾是「哈希 / 加密签名 / 对象扫描 / MP4 探测 / 行校验」混装的杂项桶，
 * 现按单一职责拆分到 lib/video/（hash / sign / scan / mp4 / validate），
 * 本文件保留为门面，re-export 全部原有导出，上传链路与测试的 require 路径不变。
 */
const {
  md5hex, etagOf, etagFromSha1Hex, streamHashes, hmac, sha256hex,
} = require('./video/hash');
const { decryptVodToken, awsSigV4, authExpOf } = require('./video/sign');
const { findItemIds } = require('./video/scan');
const { probeVideo, probeVideoFile, findMoovInTail } = require('./video/mp4');
const { validateUploadRow, skipError, CAPTION_MAX_LENGTH } = require('./video/validate');

module.exports = {
  md5hex,
  etagOf,
  etagFromSha1Hex,
  streamHashes,
  hmac,
  sha256hex,
  decryptVodToken,
  awsSigV4,
  authExpOf,
  findItemIds,
  probeVideo,
  probeVideoFile,
  findMoovInTail,
  validateUploadRow,
  skipError,
  CAPTION_MAX_LENGTH,
};
