// 剪贴板辅助：统一复制文本的容错封装，避免各页面各写一份 try/catch。
export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
