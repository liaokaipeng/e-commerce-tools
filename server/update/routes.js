'use strict';
/**
 * 版本与更新路由注册：
 *   GET  /api/version        当前版本（package.json 的 version + 打包时写入的 commit / 构建时间）
 *   GET  /api/update/check   拉取远端清单并比对，返回是否有新版本（失败时回落到本地上次结果）
 *   POST /api/update/apply   一键更新（SSE 进度）
 */
const { sendJson, sse } = require('../lib/http-utils');
const version = require('../lib/version');

const { checkNow } = require('./manifest');
const { applyUpdate } = require('./apply');

function register({ get, post }) {
  get('/api/version', (req, res) => {
    sendJson(res, 200, Object.assign({ ok: true }, version.info()));
  });

  get('/api/update/check', async (req, res) => {
    try {
      sendJson(res, 200, Object.assign({ ok: true }, await checkNow()));
    } catch (e) {
      sendJson(res, 200, { ok: false, error: (e && e.message) || String(e) });
    }
  });

  // 一键更新走 SSE：下载 + 解压 + 依赖安装可能耗时几分钟，前端需要看到进度
  post('/api/update/apply', async (req, res) => {
    const emit = sse(res);
    try {
      const r = await applyUpdate(emit);
      emit(Object.assign({
        phase: 'done',
        ok: true,
        message: `已更新到 v${r.version}：请关闭本窗口后重新双击 启动.bat 生效`,
      }, r));
    } catch (e) {
      emit({ phase: 'error', ok: false, message: (e && e.message) || String(e) });
    } finally {
      try { res.end(); } catch { /* 客户端已断开 */ }
    }
  });
}

module.exports = { register };
