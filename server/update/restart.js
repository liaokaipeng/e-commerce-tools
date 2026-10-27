'use strict';
/**
 * 重启服务：延迟拉起仓库根的 `启动.bat`。
 *
 * 为什么不在 Node 里自己 taskkill：结束旧实例、关旧黑窗口的逻辑已经统一放在 `启动.bat`
 * （它只会结束「本项目 node」，端口被别的程序占用时不动手），这里重复一份必然漂移，
 * 还有误杀非本项目进程的风险。所以本模块只负责「开一个新窗口跑 bat」。
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const { ROOT } = require('./config');

/**
 * 延迟重启：先让 HTTP 响应（SSE 收尾）飞出去，再拉起 `启动.bat`。
 * @param {number} [delayMs] 延迟毫秒数
 * @returns {string} 启动的 bat 绝对路径
 */
function scheduleRestart(delayMs = 800) {
  const bat = path.join(ROOT, '启动.bat');
  if (!fs.existsSync(bat)) throw new Error('未找到 启动.bat，请手动双击启动');
  setTimeout(() => {
    // detached + stdio:ignore：新窗口独立运行，不随本进程退出而结束
    const child = spawn('cmd.exe', ['/c', 'start', '', bat], {
      cwd: ROOT,
      detached: true,
      stdio: 'ignore',
      windowsHide: false,
    });
    child.unref();
  }, delayMs);
  return bat;
}

module.exports = { scheduleRestart };
