'use strict';
// 单元测试：竞价金额换算、取消竞价的待改进列表解析、取消注册 Hot Listing 的 SPU 解析与已注册列表提取。
const { t } = require('../helpers');
const { toAmount } = require('../../server/bidding');
const biddingCancel = require('../../server/bidding-cancel');
const hotlistingCancel = require('../../server/hotlisting-cancel');

async function run() {
  // ===== 竞价金额换算 =====
  t('toAmount 空值返回空串', toAmount(null) === '' && toAmount('0') === '');
  t('toAmount 分转元', toAmount(100000) === 1);
  t('toAmount 四舍五入到分', toAmount(12345678) === 123.46);

  // ===== 取消竞价：待改进列表解析 =====
  t('bidding-cancel toAmount 与 bidding 一致', biddingCancel.toAmount(12345678) === 123.46 && biddingCancel.toAmount(null) === '');
  {
    const data = {
      list: [
        {
          item_id: '111',
          item_name: '商品A',
          model_list: [
            {
              product_info: { model_id: 'm1', model_name: '型号1' },
              bidding_info: { bid_id: 'b1', bid_price: '17900000', default_suggest_price: '20700000' },
            },
            { product_info: { model_id: 'm2' }, bidding_info: { bid_price: '1' } }, // 无 bid_id，跳过
          ],
        },
        { item_id: '222', item_name: '商品B', model_list: [] },
      ],
    };
    const rows = biddingCancel.extractImprovementItems(data);
    t('extractImprovementItems 提取待改进竞价行', rows.length === 1 && rows[0].bidId === 'b1' && rows[0].itemId === '111' && rows[0].modelName === '型号1', JSON.stringify(rows));
    t('extractImprovementItems 金额换算正确', rows.length === 1 && rows[0].price === 179 && rows[0].suggestedPrice === 207, JSON.stringify(rows));
    t('extractImprovementItems 空数据返回空数组', biddingCancel.extractImprovementItems({ list: [] }).length === 0 && biddingCancel.extractImprovementItems(null).length === 0);
  }

  // ===== 取消注册 Hot Listing：SPU 解析与已注册列表提取 =====
  {
    t('parseSpuList 多行/逗号/空格混合解析并去重', (() => {
      const r = hotlistingCancel.parseSpuList('42555837160, 42555837161\n42555837160 123456789');
      return !r.error && r.spus.length === 3 && r.spus[0] === '42555837160' && r.spus[2] === '123456789';
    })());
    t('parseSpuList 数组输入', (() => {
      const r = hotlistingCancel.parseSpuList(['42555837160', '42555837161']);
      return !r.error && r.spus.length === 2;
    })());
    t('parseSpuList 空输入报错', !!hotlistingCancel.parseSpuList('').error && !!hotlistingCancel.parseSpuList('   ').error);
    t('parseSpuList 非法内容报错', (() => {
      const r = hotlistingCancel.parseSpuList('abc\n42555837160');
      return !!r.error && r.error.includes('abc');
    })());

    const data = {
      vrsku_info_list: [
        {
          vsku_info: { vsku_id: 325204957142, title: '商品A v', variation_name: '白色', vitem_id: 47152120886 },
          rsku_info: { rsku_id: 146728386921, title: '商品A', variation_name: 'White, 5m 50LED', seller_decision: 1, qualification_flags: 1, ritem_id: 22332369301 },
          vitem_info: { preview_link: 'https://shopee.ph/product/1/2' },
        },
        {
          vsku_info: { vsku_id: 2, vitem_id: 2 },
          rsku_info: { rsku_id: 2, seller_decision: 0 }, // 未注册，跳过
        },
        {
          vsku_info: { vsku_id: 3, vitem_id: 3 },
          rsku_info: { rsku_id: 3, seller_decision: 1, qualification_flags: 1 }, // 已注册且资格正常
        },
        {
          vsku_info: { vsku_id: 4, vitem_id: 4 },
          rsku_info: { rsku_id: 4, seller_decision: 1, qualification_flags: 0 }, // 资格异常（如 stock_unqualified），不可取消注册，跳过
        },
      ],
    };
    const rows = hotlistingCancel.extractEnrolledSkus(data);
    t('extractEnrolledSkus 只提取已注册且资格正常(seller_decision=1 & qualification_flags=1)行',
      rows.length === 2 && rows[0].rskuId === '146728386921' && rows[0].vskuId === '325204957142' && rows[1].rskuId === '3',
      JSON.stringify(rows));
    t('extractEnrolledSkus 提取标题/规格/预览链接', rows[0].itemName === '商品A' && rows[0].modelName === 'White, 5m 50LED' && rows[0].previewLink === 'https://shopee.ph/product/1/2');
    t('extractEnrolledSkus 空数据返回空数组', hotlistingCancel.extractEnrolledSkus({ vrsku_info_list: [] }).length === 0 && hotlistingCancel.extractEnrolledSkus(null).length === 0);

    // 按店铺 SPU 配置：归一化 + 汇总
    t('normalizeSpuMap 归一化并丢弃非法项', (() => {
      const m = hotlistingCancel.normalizeSpuMap({ 100000001: '  42555837160\n123 ', abc: '1', '100000002': '   ', '100000003': 12345 });
      return Object.keys(m).length === 2 && m['100000001'] === '42555837160\n123' && m['100000003'] === '12345';
    })());
    t('normalizeSpuMap 非对象输入返回空对象', Object.keys(hotlistingCancel.normalizeSpuMap(null)).length === 0 && Object.keys(hotlistingCancel.normalizeSpuMap('x')).length === 0);
    t('resolvePerShopSpus 请求体为完整状态（清空也生效）', (() => {
      const r = hotlistingCancel.resolvePerShopSpus(['1', '2'], { 1: '11111\n22222', 2: '' }, { 1: '99999', 2: '33333' });
      return r.perShop['1'].spus.join(',') === '11111,22222' && !!r.perShop['2'].error && r.validCount === 2;
    })());
    t('resolvePerShopSpus 无请求体时回落已保存配置', (() => {
      const r = hotlistingCancel.resolvePerShopSpus(['1', '2'], null, { 1: '99999', 2: '33333' });
      return r.perShop['1'].spus[0] === '99999' && r.perShop['2'].spus[0] === '33333' && r.validCount === 2;
    })());
    t('resolvePerShopSpus 未配置店铺返回 error', (() => {
      const r = hotlistingCancel.resolvePerShopSpus(['1', '2'], null, { 1: '11111' });
      return !r.perShop['1'].error && !!r.perShop['2'].error && r.validCount === 1;
    })());
    t('resolvePerShopSpus 非法 SPU 内容返回 parseSpuList 错误', (() => {
      const r = hotlistingCancel.resolvePerShopSpus(['1'], { 1: 'abc' }, {});
      return !!r.perShop['1'].error && r.perShop['1'].error.includes('abc');
    })());
  }
}

module.exports = { run };
