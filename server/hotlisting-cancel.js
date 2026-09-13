/**
 * Shopee 取消注册 Hot Listing 模块（CommonJS）
 * 由合并服务 main.js 引入，通过 register({ get, post }) 注册路由（本文件只注册路由）。
 * 与竞价导出/取消竞价共用同一份登录 Cookie（server/data/bidding-session.json，扩展推送保存）。
 *
 * 人工流程还原（接口还原，不用 UI 自动化）：
 *   访问 portal/marketing/cmt-buy-box?spuId=<SPU>，状态筛「已注册」，逐条点「取消注册」即：
 *   1) POST /api/mkt/buybox/get_rsku_vsku_list
 *      body { from_condition:{spu_id}, search_filter:{rsku_status:2, item_name:""},
 *             page_info:{offset, limit} }（rsku_status=2 即「已注册」，offset/limit 翻页）
 *      返回 data.vrsku_info_list[]：vsku_info.vsku_id / rsku_info.rsku_id（seller_decision=1 已注册；
 *      其中 qualification_flags=1 才是资格正常、可取消注册的行，=0 为异常行须过滤），
 *      data.page_info.total_count 为已注册总数；
 *   2) POST /api/mkt/buybox/update_enroll
 *      body { rsku_id, vsku_id, seller_decision:0 }，返回 code=0 且 seller_decision 变回 0 即成功。
 * 公共查询参数：SPC_CDS_VER=2 & SPC_CDS=<Cookie 值> & cnsc_shop_id=<店铺ID> & cbsc_shop_region=<市场>。
 *
 * 链路拆分到 hotlisting-cancel/ 子模块：
 *   constants.js  常量（配置路径 / 翻页 / 取消间隔）
 *   parse.js      纯解析（SPU 输入 / 响应行提取 / 配置归一化与按店汇总）
 *   config.js     SPU 配置持久化
 *   api.js        接口调用（列表 / 取消注册）
 *   preview.js    预览编排（JSON）
 *   job.js        执行编排（SSE + 暂停/继续/取消）
 */
'use strict';
const { sendJson, readJsonBodySoft } = require('./lib/http-utils');
// 长任务注册中心（暂停 / 继续 / 取消 / SSE 断开即取消 / TTL 清理）：与取消竞价共用
const jobs = require('./lib/jobs');
const { loadSpuConfig, saveSpuConfig } = require('./hotlisting-cancel/config');
const {
  parseSpuList, extractEnrolledSkus, normalizeSpuMap, resolvePerShopSpus,
} = require('./hotlisting-cancel/parse');
const { fetchEnrolledSkus, unenrollSku } = require('./hotlisting-cancel/api');
const { handlePreview } = require('./hotlisting-cancel/preview');
const { handleRun } = require('./hotlisting-cancel/job');

// ============ 路由注册 ============
function register({ get, post }) {
  // 各店铺 SPU 配置：读取 / 保存（前端编辑后自动保存）
  get('/api/hotlisting-cancel/spu-config', async (req, res, query) => {
    sendJson(res, 200, { ok: true, map: loadSpuConfig() });
  });

  post('/api/hotlisting-cancel/spu-config', async (req, res) => {
    const parsed = await readJsonBodySoft(req, '/api/hotlisting-cancel/spu-config');
    try {
      const map = normalizeSpuMap(parsed.map);
      saveSpuConfig(map);
      sendJson(res, 200, { ok: true, map });
    } catch (e) {
      sendJson(res, 500, { ok: false, msg: '保存 SPU 配置失败：' + e.message });
    }
  });

  post('/api/hotlisting-cancel/preview', async (req, res) => {
    const parsed = await readJsonBodySoft(req, '/api/hotlisting-cancel/preview');
    handlePreview(parsed, res);
  });

  post('/api/hotlisting-cancel/run', async (req, res) => {
    const parsed = await readJsonBodySoft(req, '/api/hotlisting-cancel/run');
    handleRun(parsed, res);
  });

  // 暂停 / 继续 / 取消执行中的任务（body { jobId }，jobId 由 run 的 start 事件下发）
  // 三个路由的样板与 404 语义统一由 lib/jobs.registerControlRoutes 提供
  jobs.registerControlRoutes(post, '/api/hotlisting-cancel');
}

module.exports = { register, parseSpuList, extractEnrolledSkus, fetchEnrolledSkus, unenrollSku, normalizeSpuMap, resolvePerShopSpus };
