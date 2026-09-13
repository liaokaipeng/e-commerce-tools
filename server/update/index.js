'use strict';
/**
 * 版本与自更新（门面）
 *
 *   GET  /api/version        当前版本（package.json 的 version + 打包时写入的 commit / 构建时间）
 *   GET  /api/update/check   拉取远端清单并比对，返回是否有新版本（失败时回落到本地上次结果）
 *   POST /api/update/apply   一键更新（SSE 进度）：下载 → 校验 sha256 → 解压 → 备份数据 → 白名单覆盖 → 依赖差异安装
 *
 * 设计约束（与仓库「极简零配置」一致）：
 *   - **不新增运行时依赖**：下载用 Node 内置 fetch，解压调用系统自带的 tar（Win10 1803+ 内置 bsdtar）。
 *     探测不到 tar 时明确报错并降级为「手动下载覆盖」，不静默失败、也不为此引入 npm 包。
 *   - **不引入环境变量**：清单地址读 server/config/update.json（随包分发、由发布方填写）；
 *     单机若需指向别的镜像，写 server/data/update-config.json（data 目录永不被更新覆盖）。
 *   - **更新只按白名单覆盖，绝不动 server/data/**（真实店铺授权与 Cookie）、node_modules 与用户导出文件；
 *     覆盖前先把 server/data 整目录备份到 backup/data-<时间戳>。
 *   - 程序文件落盘后**必须重启服务才生效**（后端模块已加载进内存），接口如实返回 restartRequired。
 *
 * 实现已按单一职责拆分到 server/update/ 子目录，本文件只做装配与对外导出（保持导出不变）：
 *   config.js（配置/路径）· whitelist.js（白名单与合并备份）· archive.js（解压与包校验）
 *   download.js（流式下载）· manifest.js（清单拉取比对）· deps.js（依赖差异安装）
 *   apply.js（更新编排）· routes.js（路由注册）· schedule.js（启动后自动检查）
 */
const { register } = require('./routes');
const { startAutoCheck } = require('./schedule');
const { checkNow } = require('./manifest');
const { applyUpdate } = require('./apply');
const { loadConfig } = require('./config');
const { COPY_ITEMS } = require('./whitelist');

module.exports = { register, startAutoCheck, checkNow, applyUpdate, loadConfig, COPY_ITEMS };
