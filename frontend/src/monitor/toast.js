// 轻量提示：统一 Element Plus 消息类型分发，供监控页各模块共用。
import { ElMessage } from 'element-plus';

export function showToast(msg, type = 'info') {
  if (type === 'success') ElMessage.success(msg);
  else if (type === 'error') ElMessage.error(msg);
  else if (type === 'warning') ElMessage.warning(msg);
  else ElMessage.info(msg);
}
