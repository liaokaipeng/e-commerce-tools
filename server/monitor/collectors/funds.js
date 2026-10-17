'use strict';
// 资金域采集：打款金额、担保释放兜底、钱包流水状态与余额。
// 接口形态（官方文档 2026-08 调研，未生产实测）：
//   payment.get_payout_detail               payout_time_from/to(≤15天)+page_size+page_no(1起,均必填)，仅跨境，官方已标记过时
//   payment.get_escrow_list                 release_time_from/to+page_no(1起)，仅返回已释放记录（无状态字段），作打款金额兜底
//   payment.get_wallet_transaction_list     page_no(offset 0起,必填)+page_size+create_time_from/to(≤15天)，仅本土，
//                                           status=FAILED/COMPLETED/PENDING/INITIAL 为唯一带状态的资金接口
const { collectByPage } = require('./paging');
const { detail, firstOf, fmtSec, sumAmountRows, walletSummary, allPermissionDenied } = require('./parse');
const { PAGE_SIZE, FUNDS_WINDOW_DAYS, SEC_PER_DAY } = require('./constants');

async function collectFundsDomain(shopId) {
  const metrics = {};
  const errors = [];
  const details = {};
  const nowSec = Math.floor(Date.now() / 1000);
  const winFrom = nowSec - FUNDS_WINDOW_DAYS * SEC_PER_DAY; // 三接口同一时间窗起点
  let anyOk = false;
  // 单个子接口独立容错：失败只记 errors，不影响其余子接口与整域
  const step = async (label, fn) => {
    try {
      await fn();
      anyOk = true;
    } catch (e) {
      errors.push(label + '：' + e.message);
    }
  };

  // 1) 打款明细（仅跨境；金额合计 → 近15天打款金额）
  await step('打款明细', async () => {
    const list = await collectByPage(shopId, '/api/v2/payment/get_payout_detail', {
      payout_time_from: winFrom,
      payout_time_to: nowSec,
      page_size: PAGE_SIZE,
    }, 'payout_list', 1);
    const s = sumAmountRows(list, {
      amountOf: (p) => (p && p.payout_info || {}).payout_amount,
      idKeys: ['payout_id', 'payout_sn'],
      timeKeys: ['payout_time', 'create_time'],
    });
    if (s.got) {
      metrics['funds.payout_15d'] = s.total;
      details['funds.payout_15d'] = detail('', s.rows);
    }
  });

  // 2) 担保释放列表（官方无状态字段、仅已释放记录；payout_detail 不可用时作打款金额兜底）
  await step('担保列表', async () => {
    const list = await collectByPage(shopId, '/api/v2/payment/get_escrow_list', {
      release_time_from: winFrom,
      release_time_to: nowSec,
      page_size: PAGE_SIZE,
    }, 'escrow_list', 1);
    if (metrics['funds.payout_15d'] != null) return; // 打款明细已产出，不覆盖
    const s = sumAmountRows(list, {
      amountOf: (it) => (it || {}).payout_amount,
      idKeys: ['escrow_id', 'order_sn'],
      timeKeys: ['release_time', 'create_time'],
    });
    if (s.got) {
      metrics['funds.payout_15d'] = s.total;
      details['funds.payout_15d'] = detail('近15天已释放担保金额合计（官方担保列表无状态字段，仅已释放记录）', s.rows);
    }
  });

  // 3) 钱包流水（仅本土；唯一带状态字段的资金接口：处理中/失败计数 + 最新余额）
  await step('钱包流水', async () => {
    const txns = await collectByPage(shopId, '/api/v2/payment/get_wallet_transaction_list', {
      page_size: PAGE_SIZE,
      create_time_from: winFrom,
      create_time_to: nowSec,
    }, 'transaction_list', 0);
    const s = walletSummary(txns);
    metrics['funds.pending_txn'] = s.pending;
    metrics['funds.failed_txn'] = s.failed;
    if (s.balance != null) metrics['funds.wallet_balance'] = s.balance;
    const pendingRows = [];
    const failedRows = [];
    for (const t of txns || []) {
      const st = String((t && t.status) || '').toUpperCase();
      if (st !== 'PENDING' && st !== 'INITIAL' && st !== 'FAILED') continue;
      const id = String(firstOf(t, ['transaction_id', 'wallet_transaction_id', 'reference_id']) || '');
      const row = {
        id,
        title: id || ('流水·' + st),
        sub: `${st}${t && t.amount != null ? '·金额 ' + t.amount : ''}${t && t.create_time ? '·' + fmtSec(t.create_time) : ''}`,
      };
      (st === 'FAILED' ? failedRows : pendingRows).push(row);
    }
    details['funds.pending_txn'] = detail('', pendingRows);
    details['funds.failed_txn'] = detail('', failedRows);
  });

  if (!anyOk) {
    if (allPermissionDenied(errors)) return { domain: 'funds', metrics, errors, unsupported: true, reason: errors.join('；') };
    throw new Error(errors.join('；') || '资金域无可用数据');
  }
  return { domain: 'funds', metrics, details, errors };
}

module.exports = { collectFundsDomain };
