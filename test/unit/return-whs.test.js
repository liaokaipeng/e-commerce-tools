'use strict';
// 单元测试：获取退单仓库的 Return ID 归一化、whs_id 提取、执行分块与入参行归一化。
// 只测纯函数，不打真实网关（get_return_detail 的链路口径以 shopee_skill 实测为准）。
const { t } = require('../helpers');
const { normalizeReturnId, extractWhsId, splitChunks } = require('../../server/return-whs/parse');
const { normalizeRows, MAX_ROWS, CHUNK_SIZE } = require('../../server/return-whs/job');

async function run() {
  // ===== Return ID 归一化 =====
  t('normalizeReturnId 原样返回纯 ID', normalizeReturnId('RTN12345TEST0001') === 'RTN12345TEST0001');
  t('normalizeReturnId 去首尾及内部空白', normalizeReturnId('  RTN12345 TEST\t0001\n') === 'RTN12345TEST0001');
  t('normalizeReturnId 去零宽字符', normalizeReturnId('RTN\u200b12345\ufeffTEST0001') === 'RTN12345TEST0001');
  t('normalizeReturnId 空值返回空串', normalizeReturnId(null) === '' && normalizeReturnId(undefined) === '' && normalizeReturnId('   ') === '');
  t('normalizeReturnId 数字输入转字符串', normalizeReturnId(26101008) === '26101008');

  // ===== whs_id 提取（实测响应结构：response.return_address.whs_id） =====
  {
    const resp = { response: { return_sn: 'RTN12345TEST0001', return_address: { whs_id: 'PHBUL4' } } };
    t('extractWhsId 取到仓库 ID', extractWhsId(resp) === 'PHBUL4');
    t('extractWhsId 去首尾空格', extractWhsId({ response: { return_address: { whs_id: ' PHBUL4 ' } } }) === 'PHBUL4');
  }
  t('extractWhsId 无 return_address 返回空串', extractWhsId({ response: { return_sn: 'x' } }) === '');
  t('extractWhsId whs_id 为空串返回空串', extractWhsId({ response: { return_address: { whs_id: '' } } }) === '');
  t('extractWhsId whs_id 为 null 返回空串', extractWhsId({ response: { return_address: { whs_id: null } } }) === '');
  t('extractWhsId 整体空响应不抛错', extractWhsId(null) === '' && extractWhsId({}) === '' && extractWhsId({ response: null }) === '');

  // ===== 执行分块 =====
  {
    const rows = Array.from({ length: 45 }, (_, i) => ({ rowIndex: i + 1, returnId: 'R' + i }));
    const chunks = splitChunks(rows, CHUNK_SIZE);
    t('splitChunks 45 行按 20 切 3 块', chunks.length === 3 && chunks[0].length === 20 && chunks[2].length === 5);
    t('splitChunks 块内保持原行对象', chunks[1][0] === rows[20]);
  }
  t('splitChunks 空数组返回空', splitChunks([], 20).length === 0 && splitChunks(null, 20).length === 0);
  t('splitChunks 非正 size 按 1 兜底不抛错', splitChunks([{ a: 1 }, { a: 2 }], 0).length === 2);

  // ===== 入参行归一化（job.js，多店铺：店铺ID 按行带） =====
  {
    const rows = normalizeRows([
      { rowIndex: 1, returnId: ' RTN12345TEST0001 ', shopId: ' 953673451 ' },
      { rowIndex: 2, returnId: '' },          // 空 Return ID，过滤
      { rowIndex: 3 },                         // 缺 returnId，过滤
      { rowIndex: 4, returnId: '2610084ABCDE', shopId: 123456789 },
      { returnId: '2610085FGHIJ', shopId: '953673451.0' }, // 缺 rowIndex，回退为下标 4
    ]);
    t('normalizeRows 过滤空 Return ID 行', rows.length === 3);
    t('normalizeRows 归一化 Return ID', rows[0].returnId === 'RTN12345TEST0001');
    t('normalizeRows 保留 rowIndex', rows[0].rowIndex === 1 && rows[2].rowIndex === 4);
    t('normalizeRows 归一化店铺ID', rows[0].shopId === '953673451' && rows[1].shopId === '123456789' && rows[2].shopId === '953673451');
    t('normalizeRows 缺店铺ID 保留为空串（由 handleRun 显式 400）', normalizeRows([{ rowIndex: 1, returnId: 'R1' }])[0].shopId === '');
    t('normalizeRows 非数组输入返回空数组', normalizeRows(null).length === 0 && normalizeRows('x').length === 0);
  }
  t('MAX_ROWS / CHUNK_SIZE 为正整数常量', MAX_ROWS === 2000 && CHUNK_SIZE === 20);
}

module.exports = { run };
