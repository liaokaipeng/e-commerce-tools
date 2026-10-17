// 确认对话框助手：统一「警告类型 + danger 确认按钮」的确认框（取消竞价 / 取消 Hot Listing 复用），
// 也支持 info 形态（「设为默认目录」）。用户取消时静默 resolve(false)，调用方 return 即可。
import { ElMessageBox } from 'element-plus';

/**
 * @param {object} o
 *   - message     确认正文（\n 换行由 ElMessageBox 渲染）
 *   - title       标题
 *   - confirmText 确认按钮文案
 *   - cancelText  取消按钮文案（默认「取消」）
 *   - type        ElMessageBox 类型（默认 'warning'）
 *   - danger      确认按钮是否用 danger 样式（默认 true）
 * @returns {Promise<boolean>} true = 用户确认；false = 用户取消
 */
export async function confirmDanger({ message, title, confirmText, cancelText = '取消', type = 'warning', danger = true }) {
  try {
    await ElMessageBox.confirm(message, title, {
      confirmButtonText: confirmText,
      cancelButtonText: cancelText,
      type,
      ...(danger ? { confirmButtonClass: 'el-button--danger' } : {}),
    });
    return true;
  } catch {
    return false; // 用户取消
  }
}
