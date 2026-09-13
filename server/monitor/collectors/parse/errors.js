'use strict';
// 采集错误分类（纯函数）：区分「权限不足/未开通」与其他错误。
/** 是否为「权限不足/未开通」类错误（区别于网络/参数/凭证错误，命中则该域跳过且不触发系统自检告警） */
function isPermissionDenied(message) {
  return /permission|no permission|not authorized|not permitted|forbidden|无权|未开通|无权限/i.test(String(message || ''));
}

/** 全部子调用均因权限不足失败 → 该店该域不支持（调度器跳过且不触发系统自检告警） */
function allPermissionDenied(errors) {
  return Array.isArray(errors) && errors.length > 0 && errors.every((e) => isPermissionDenied(String(e || '')));
}

module.exports = { isPermissionDenied, allPermissionDenied };
