'use strict';
/**
 * 通用 JSON 文件读写：统一「读不到返回兜底 / 写时自动建父目录」样板。
 * 原先 monitor/store、update、shopee-session 各写一份读 JSON，现收敛到此处；
 * 告警策略由调用方通过 onError 注入（有的静默、有的打日志）。
 */
const fs = require('fs');
const path = require('path');

/**
 * 读取 JSON 文件：不存在或解析失败返回 fallback（默认 null）。
 * @param {string} file
 * @param {*} [fallback]
 * @param {(e: Error, file: string) => void} [onError] 解析失败时的告警回调（可选）
 */
function readJson(file, fallback = null, onError) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
  } catch (e) {
    if (onError) onError(e, file);
    return fallback;
  }
}

/** 写 JSON 文件（自动创建父目录，2 空格缩进）；失败抛错，由调用方决定是否吞掉 */
function writeJson(file, data, { space = 2 } = {}) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, space));
}

module.exports = { readJson, writeJson };
