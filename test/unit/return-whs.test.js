'use strict';
// 单元测试：获取退单仓库的字段归一化、退货仓筛选、轨迹匹配、执行分块与入参行归一化。
// 只测纯函数，不打真实网关（接口口径以 2026-11 生产店铺实测为准，见 docs/开放平台链路.md §5）。
const { t } = require('../helpers');
const {
  normalizeReturnId, normalizeRegion, extractWhsId, pickWarehouseList,
  pickReturnWarehouses, toWarehouseResult, matchWarehouseByTracking, splitChunks,
} = require('../../server/return-whs/parse');
const { normalizeRows, MAX_ROWS, CHUNK_SIZE } = require('../../server/return-whs/job');

// 实测样本（已脱敏）：同一店铺的跨境仓 + 菲律宾本地仓，以及已送达的逆向轨迹
const WHS_SAMPLE = [
  {
    warehouse_id: 100158339, warehouse_name: '中国退货仓库', warehouse_type: 2,
    region: 'CN', state: '广东省', city: '深圳市', district: '龙华区', town: '',
    address: '广东省深圳市龙华区观澜街道南岳工业区（鸿恒景电商园）2栋3001',
  },
  {
    warehouse_id: 100523457, warehouse_name: '爱亚仓PH03-Laguna退', warehouse_type: 2,
    region: 'PH', state: 'South Luzon', city: 'Laguna', district: 'Calamba City', town: 'Makiling',
    address: 'Purok 1 Barangay Makiling Calamba Laguna Philippines 4027',
  },
];
const TRACKING_SAMPLE = {
  response: {
    reverse_logistics_status: 'LOGISTICS_DELIVERY_DONE',
    tracking_info: [
      { update_time: 1793934215, tracking_description: 'Parcel has been delivered' },
      { update_time: 1793930000, tracking_description: 'Parcel is out for delivery' },
      { update_time: 1793920000, tracking_description: 'Delivery driver has been assigned' },
      { update_time: 1793910000, tracking_description: 'Parcel has arrived at sorting facility : OP Makiliing Calamba Hub' },
      { update_time: 1793900000, tracking_description: 'Buyer is preparing to ship your parcel' },
    ],
  },
};

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

  // ===== 站点归一化与退货仓筛选 =====
  t('normalizeRegion 转大写去空白', normalizeRegion(' ph ') === 'PH' && normalizeRegion('Ph') === 'PH');
  t('normalizeRegion 空值返回空串', normalizeRegion(null) === '' && normalizeRegion(undefined) === '');
  t('pickWarehouseList 取 response 数组', pickWarehouseList({ response: WHS_SAMPLE }).length === 2);
  t('pickWarehouseList 非数组返回空', pickWarehouseList({ response: {} }).length === 0 && pickWarehouseList(null).length === 0);
  {
    const ph = pickReturnWarehouses(WHS_SAMPLE, 'PH');
    t('pickReturnWarehouses 按站点只剩 1 个仓', ph.length === 1 && ph[0].warehouse_id === 100523457);
    t('pickReturnWarehouses 站点为空返回全部', pickReturnWarehouses(WHS_SAMPLE, '').length === 2);
    t('pickReturnWarehouses 站点无匹配返回空', pickReturnWarehouses(WHS_SAMPLE, 'MY').length === 0);
    t('pickReturnWarehouses 过滤非退货仓类型', pickReturnWarehouses([{ warehouse_id: 1, warehouse_type: 1, region: 'PH' }], 'PH').length === 0);
  }
  {
    const r = toWarehouseResult(WHS_SAMPLE[1]);
    t('toWarehouseResult 输出 ID / 名称 / 地址', r.whsId === '100523457' && r.whsName === '爱亚仓PH03-Laguna退' && r.whsAddress.includes('Calamba'));
    t('toWarehouseResult 空对象不抛错', toWarehouseResult(null).whsId === '');
  }

  // ===== 逆向物流轨迹匹配（实测：终点分拣中心名与仓的 district 命中） =====
  {
    const hit = matchWarehouseByTracking(TRACKING_SAMPLE, WHS_SAMPLE);
    t('matchWarehouseByTracking 命中 Calamba 仓', !!hit && hit.warehouse_id === 100523457);
    t('matchWarehouseByTracking 命中本地仓而非跨境仓', !!hit && hit.region === 'PH');
  }
  t('matchWarehouseByTracking 无轨迹返回 null', matchWarehouseByTracking({ response: {} }, WHS_SAMPLE) === null);
  t('matchWarehouseByTracking 轨迹无地名返回 null', matchWarehouseByTracking({ response: { tracking_info: [{ update_time: 1, tracking_description: 'Parcel has been delivered' }] } }, WHS_SAMPLE) === null);
  t('matchWarehouseByTracking 无候选仓返回 null', matchWarehouseByTracking(TRACKING_SAMPLE, []) === null);
  {
    // 轨迹乱序时按 update_time 倒序，不应被旧节点误判
    const reversed = { response: { tracking_info: TRACKING_SAMPLE.response.tracking_info.slice().reverse() } };
    const hit = matchWarehouseByTracking(reversed, WHS_SAMPLE);
    t('matchWarehouseByTracking 乱序轨迹仍正确命中', !!hit && hit.warehouse_id === 100523457);
  }

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
    {
      // 多客退款单表的「店铺」列：店名末尾就是 shop_id
      const fromName = normalizeRows([
        { rowIndex: 1, returnId: 'R1', shopId: 'SP-DM_PH-1店-(元仓+官方仓）-zhangdm1.ph-557630453' },
        { rowIndex: 2, returnId: 'R2', shopId: 'TK本土-PH-5' },
      ]);
      t('normalizeRows 从店名末尾提取店铺ID', fromName[0].shopId === '557630453');
      t('normalizeRows 店名无店铺ID 返回空串', fromName[1].shopId === '');
    }
    {
      const withRegion = normalizeRows([{ rowIndex: 1, returnId: 'R1', shopId: '1', region: ' ph ' }]);
      t('normalizeRows 归一化站点', withRegion[0].region === 'PH');
      t('normalizeRows 缺站点为空串（后端按店铺区域兜底）', normalizeRows([{ rowIndex: 1, returnId: 'R2', shopId: '1' }])[0].region === '');
    }
    t('normalizeRows 非数组输入返回空数组', normalizeRows(null).length === 0 && normalizeRows('x').length === 0);
  }
  t('MAX_ROWS / CHUNK_SIZE 为正整数常量', MAX_ROWS === 2000 && CHUNK_SIZE === 20);
}

module.exports = { run };
