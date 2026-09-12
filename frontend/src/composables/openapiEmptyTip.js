// 「选择店铺」空缓存提示：查开放平台状态区分原因（未配置 App / 未授权店铺），
// 返回引导用户去授权的文案。useShopeeSession 与 video/useVideoCreds 共用。
import { ElMessage } from 'element-plus';

export async function resolveOpenapiEmptyTip() {
  try {
    const r = await fetch('/api/openapi/status');
    const s = await r.json();
    if (!s.configured) {
      return '尚未配置开放平台 App：请先到「开放平台」页填写 partner_id / partner_key，再生成授权链接完成店铺授权。';
    }
    if (!(s.shops || []).length) {
      return '缓存里没有已授权店铺：请到「开放平台」页生成授权链接并完成店铺授权，完成后回来点「重新加载」。';
    }
  } catch { /* 状态接口不可用时给通用提示 */ }
  return '暂无已授权店铺：请先到「开放平台」Tab 完成 App 配置与店铺授权。';
}

/** 空店铺时弹一次 warning（配合空状态文案用） */
export function warnEmptyTip(tip) {
  ElMessage.warning(tip);
}
