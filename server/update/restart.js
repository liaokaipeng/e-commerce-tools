'use strict';
/**
 * 重启服务：写重启标记 + 延迟拉起仓库根的 `启动.bat`。
 *
 * 为什么不在 Node 里自己 taskkill：结束旧实例、关旧黑窗口的逻辑已经统一放在 `启动.bat`
 * （它只会结束「本项目 node」，端口被别的程序占用时不动手），这里重复一份必然漂移，
 * 还有误杀非本项目进程的风险。所以本模块只负责「写标记 + 开一个新窗口跑 bat」。
 *
 * 为什么要标记：Windows Terminal 默认 closeOnExit=graceful，只有进程正常退出（退出码 0）
 * 才会关闭旧标签页。`启动.bat` 在 node 退出后看到该标记就干净退出（`cmd /c` 窗口靠 `exit /b 0`，
 * `cmd /K` 窗口必须用整条 `exit`），旧黑窗口才会真正关掉；旧版 bat 不认识标记会一直留着
 * （新进程启动后由 clearRestartMarkerLater 清理残留）。
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const { ROOT, DATA_DIR } = require('./config');

const RESTART_MARKER = path.join(DATA_DIR, '.restart-requested');

/**
 * 延迟重启：先写标记、让 HTTP 响应（SSE 收尾）飞出去，再拉起 `启动.bat`。
 * @param {number} [delayMs] 延迟毫秒数
 * @returns {string} 启动的 bat 绝对路径
 */
function scheduleRestart(delayMs = 800) {
  const bat = path.join(ROOT, '启动.bat');
  if (!fs.existsSync(bat)) throw new Error('未找到 启动.bat，请手动双击启动');
  try {
    fs.writeFileSync(RESTART_MARKER, new Date().toISOString());
  } catch { /* 标记写失败不影响拉起重启 */ }
  setTimeout(() => {
    // 必须显式让新窗口里的 cmd 用 /c 跑 bat：只写 `start "" <bat>` 时 start 会用
    // `cmd /K <bat>` 打开批处理，bat 跑完（exit /b）后 cmd 仍停在提示符，旧黑窗口
    // 永远关不掉（Windows Terminal 只在退出码 0 时关标签页）。
    // detached + stdio:ignore：新窗口独立运行，不随本进程退出而结束。
    const child = spawn('cmd.exe', ['/c', 'start', '', 'cmd.exe', '/c', bat], {
      cwd: ROOT,
      detached: true,
      stdio: 'ignore',
      windowsHide: false,
    });
    child.unref();
  }, delayMs);
  return bat;
}

/**
 * 启动后延迟清理残留的重启标记：旧窗口若是不认识标记的老版本 bat，会一直留着标记，
 * 必须清掉，避免它在下一次手动退出时被误当成「重启请求」。
 * @param {number} [delayMs] 延迟毫秒数（要晚于旧窗口消费标记的时机）
 */
function clearRestartMarkerLater(delayMs = 5000) {
  const t = setTimeout(() => {
    try { fs.unlinkSync(RESTART_MARKER); } catch { /* 不存在即忽略 */ }
  }, delayMs);
  if (t.unref) t.unref();
}

module.exports = { scheduleRestart, clearRestartMarkerLater, RESTART_MARKER };
