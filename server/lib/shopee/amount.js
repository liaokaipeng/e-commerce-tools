'use strict';
/** 竞价域金额换算：接口返回单位为 1/100000 元（十万分之一元），除以 100000 得元并四舍五入到分 */
function toAmount(v) {
  if (v === null || v === undefined || v === '' || v === '0' || v === 0) return '';
  const n = Number(v) / 100000;
  return Math.round(n * 100) / 100;
}

module.exports = { toAmount };
