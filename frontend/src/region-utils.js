// 店铺地区代码 → 中文名（get_shop_info 的 region 字段，大写代码如 PH/MY/TH；未知代码原样展示）。
// 代码口径与后端 server/monitor/currency.js 的 REGION_CURRENCY 保持一致。
export const REGION_NAMES = {
  CN: '中国', TH: '泰国', PH: '菲律宾', ID: '印尼', VN: '越南', MY: '马来西亚',
  SG: '新加坡', TW: '中国台湾', HK: '中国香港', BR: '巴西', MX: '墨西哥',
  CL: '智利', CO: '哥伦比亚', AR: '阿根廷', US: '美国', GB: '英国',
  KR: '韩国', JP: '日本', IN: '印度', PL: '波兰',
};

/** 地区代码 → 展示名（如「菲律宾（PH）」；空值返回空串） */
export function regionLabel(code) {
  const c = String(code || '').toUpperCase().trim();
  if (!c) return '';
  return REGION_NAMES[c] ? `${REGION_NAMES[c]}（${c}）` : c;
}
