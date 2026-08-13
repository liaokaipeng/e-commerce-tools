'use strict';
// 视频上传模块常量与站点配置

const CHUNK_SIZE = 1 * 1024 * 1024; // 1MB 分片（与抓包一致）

const BIZ = 178;
const MMS = 'https://api.mms.shopee.cn';
const UPLOAD = 'https://up-sp.vod.shopee.cn';
const SOLUTIONS = 'https://solutions.shopee.cn';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36 Edg/150.0.0.0';

// ------- 跨境 .cn 上传固定参数（服务标识 / 地区 / SDK 版本等，供 upload-cn 复用） -------
const CN = {
  region: 'CN',
  serviceid: 'shopeeuss',
  sdkversion: '3.4.5',
  appversion: '3.4.5',
  ostype: 'web',
};

// ------- 站点配置（跨境 / 本土） -------
// cn = 跨境（.cn 覆盖多国）；ph = 本土菲律宾（一个站点一个域名）。
// 上传链路不同：cn 走分片+merge（域名/参数见顶部常量），ph 走单次 PUT+task 发布（域名/参数见此处配置）。
const SITES = {
  cn: { label: '跨境（.cn）' },
  ph: {
    label: '本土-菲律宾（.ph）',
    mms: 'https://api.mms.shopee.ph',
    creator: 'https://creator.shopee.ph',
    origin: 'https://seller.shopee.ph',
    biz: 201,
    region: 'PH',
    ostype: '2',
    sdkversion: 'mms-3.6.0',
  },
};

module.exports = { CHUNK_SIZE, BIZ, MMS, UPLOAD, SOLUTIONS, UA, CN, SITES };
