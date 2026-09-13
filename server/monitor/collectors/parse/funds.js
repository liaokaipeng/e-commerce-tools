'use strict';
// 资金域解析（纯函数）：钱包流水状态计数与最新余额。
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

module.exports = { walletSummary };
