'use strict';
// 资金域解析（纯函数）：金额行合计、钱包流水状态计数与最新余额。
const { firstOf, fmtSec, round2 } = require('./common');

/**
 * 金额行合计（纯函数）：过滤非有限金额后求和，并组装结构化明细行。
 * payout 与 escrow 两个循环原为逐字同构（仅字段名不同），收敛到此处。
 * @param {Array} list 原始记录
 * @param {object} o
 *   - amountOf {(it) => number} 取金额（字段兜底由调用方决定）
 *   - idKeys {string[]} 单号字段兜底顺序
 *   - timeKeys {string[]} 时间字段兜底顺序
 * @returns {{total: number, got: boolean, rows: Array<{id,title,sub}>}}
 */
function sumAmountRows(list, { amountOf, idKeys, timeKeys }) {
  let total = 0;
  let got = false;
  const rows = [];
  for (const it of list || []) {
    const amt = it ? Number(amountOf(it)) : NaN;
    if (!isFinite(amt)) continue;
    total += amt;
    got = true;
    rows.push({
      id: String(firstOf(it, idKeys) || ''),
      title: '金额 ' + round2(amt),
      sub: fmtSec(firstOf(it, timeKeys)),
    });
  }
  return { total: round2(total), got, rows };
}
/**
 * 钱包流水汇总（纯函数）：pending = status∈{PENDING,INITIAL} 记录数（处理中/冻结信号）、
 * failed = status=FAILED 记录数；balance = 最新一条（create_time 最大）流水的 current_balance。
 * 时间窗由调用侧 create_time_from/to（≤15 天）控制，本函数不再过滤。
 */
function walletSummary(txns) {
  let pending = 0;
  let failed = 0;
  let balance = null;
  let balanceAt = -1;
  for (const t of txns || []) {
    if (!t || typeof t !== 'object') continue;
    const st = String(t.status || '').toUpperCase();
    if (st === 'PENDING' || st === 'INITIAL') pending += 1;
    else if (st === 'FAILED') failed += 1;
    if (typeof t.current_balance === 'number' && isFinite(t.current_balance)) {
      const at = typeof t.create_time === 'number' ? t.create_time : 0;
      if (at >= balanceAt) { balance = t.current_balance; balanceAt = at; }
    }
  }
  return { pending, failed, balance };
}

module.exports = { sumAmountRows, walletSummary };
