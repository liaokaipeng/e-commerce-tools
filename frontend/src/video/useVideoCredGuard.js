// 视频上传页 · 上传前凭证就绪校验：缺凭证 / 缺 User ID / 缺店铺时给出提示并阻断上传。
import { ElMessage } from 'element-plus';

/**
 * @param {{ isPh, cookie, userid, cnShops, shopId, saveCreds }} state 聚合器持有的凭证状态
 */
export function useVideoCredGuard({ isPh, cookie, userid, cnShops, shopId, saveCreds }) {
  /** 执行上传前的凭证校验；返回 false 表示缺凭证（已提示用户） */
  function assertReady() {
    saveCreds();
    if (isPh.value && !cookie.value.trim()) {
      ElMessage.warning('尚未获取到该站点凭证：请安装扩展，登录卖家中心并在短视频页手动上传一次以自动抓取');
      return false;
    }
    if (!isPh.value && !cnShops.value.some((s) => s.hasCred)) {
      ElMessage.warning('尚未获取到跨境凭证：请安装扩展，在任一店铺短视频页手动上传一次以自动抓取（凭证账号级通用）');
      return false;
    }
    if (isPh.value && !userid.value.trim()) {
      ElMessage.warning('本土站点请填写 User ID（扩展会自动抓取，若为空请手动填写）');
      return false;
    }
    if (!isPh.value && !shopId.value.trim()) {
      ElMessage.warning('未识别到可用的跨境店铺：请安装扩展，在任一店铺短视频页手动上传一次以自动抓取凭证');
      return false;
    }
    return true;
  }

  return { assertReady };
}
