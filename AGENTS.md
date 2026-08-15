# AGENTS.md

本文件为 AI 代理（及人类协作者）提供仓库工作上下文。请先通读再动手。

## 仓库概览

本仓库为**工具合集（shopee-tools-all-in-one）**：单服务、单端口（8765）、单网页，提供四个工具（TikTok 无水印下载 / Shopee 竞价导出 / Shopee 取消竞价 / Shopee 视频批量上传）的本地 Node HTTP 服务 + 一个前端门户页，按 Tab 切换使用。其中视频上传在门户页按站点拆分为「跨境视频上传」「本土视频上传」两个 Tab（共用 `/video/` 页面，经 `?mode=cn|ph` 固定站点）。

> 架构与目录结构见 [docs/架构.md](docs/架构.md)；开发流程、后端约定与测试见 [docs/开发指南.md](docs/开发指南.md)；仓库概览与快速开始见 [docs/README.md](docs/README.md)；最终用户操作见 [新手入门指南.md](新手入门指南.md)；Shopee 开放平台接口资料（开发者指南 / API 参考整站目录，中文版）见 [shopee_api_doc/README.md](shopee_api_doc/README.md)。

## 关键约束（务必遵守）

1. **极简零配置**，双击 `启动.bat` 即用，不加环境变量/额外安装步骤。
2. **不新增运行时依赖**。
3. **接口还原，不用 UI 自动化**：直接调 Shopee 内部 HTTP 接口，遵循抓包链路；不要改成 Playwright/Selenium。
4. **端口固定 8765**，扩展与文档已硬编码。
5. **凭证不入库**，日志不完整打印 Cookie/Authorization。
6. **中文优先**，文档/注释/用户文案用中文，代码标识符可英文。
7. 改入口/端口/结构时，同步更新 `启动.bat`、`docs/README.md`、`docs/架构.md`、`AGENTS.md`（涉及视频上传链路/测试结构时还应更新 `docs/开发指南.md`）。
8. 不主动新增文档文件，用现有 `docs/README.md` / `docs/架构.md` / `docs/开发指南.md` / `新手入门指南.md` / `AGENTS.md`；Shopee 开放平台接口资料统一放 `shopee_api_doc/`（官方文档整站目录中文整理版，刷新方式见其 README）。

## 技术栈速查

- 后端一律 **CommonJS**（`require`/`module.exports`）；前端用 **Vue3 SFC**。改代码时保持文件原有风格，不混用。
- 后端依赖仅 `exceljs` / `https-proxy-agent` / `socks-proxy-agent`；前端仅 `vue` / `element-plus` / `vite`。
- 前端 tiktok/bidding/bidding-cancel 三页共用逻辑抽在 `frontend/src/composables/useToolPage.js`（默认目录 / 日志滚动 / SSE 流读取），改动时优先复用，不重复实现。
- `tiktok.js` / `video.js` 只做路由注册，链路拆到 `server/tiktok/` / `server/video/` 子模块；新增逻辑放对应子模块，不要塞回入口文件。

## 关键注意点（详见 docs/架构.md）

- 取消竞价：人工流程「竞价详情 → 进行中的竞价 → 待改进 → 逐个撤销」对应接口 `get_item_ongoing_list`（`filter.page_tab=2` 即待改进，`page_tab=1` 为进行中全部）+ `seller_withdraw`（body `{ bid_id }`）；与竞价导出共用 `bidding-session.json` 与 `stores.json`。
- 视频上传按站点拆分：cn 跨境分片+merge / ph 菲律宾单次 PUT+task；**solutions 接口成功码为 200000（非 0），有 post_id 即发布成功**。
- 跨境凭证经 `resolveCnAuth` 统一解析（账号级通用，取有效期最长者）；菲律宾需 User ID。
- 视频纯函数（md5/etag/AES/SigV4/MP4 探测/行校验）统一在 `server/lib/video-utils.js`，行校验阈值 `CAPTION_MAX_LENGTH` 与前端 `video/App.vue` 即时预览校验保持一致；新增此类纯函数放 server/lib 并补单测，不要塞回 video.js。
- 大文件**流式处理**（`streamHashes` / `readChunk` / 读流 PUT / `probeVideoFile` 探针），不得整文件 `readFileSync` 进内存。
- 任务可取消（`POST /api/cancel` + `AbortController`），取消造成的中断在 `call` 里不重试。
- SSE 事件按 job 缓存（`jobEvents`），迟到连接自动回放，否则前端可能一直卡在「上传中」。
- 扩展（MV3）抓凭证推 `/api/creds`，缓存在 `chrome.storage.local`，抓到新请求时整包重推（故 `video-session.json` 清空后会被自动写回）。

## 测试

`node test.js`（或 `npm test`）：单元（`test/unit.test.js`，纯函数 + 任务取消，不启动服务）+ 接口冒烟（`test/api.test.js`，临时端口 8865，含 SSE 迟到回放、任务取消与 404 兜底），**不访问真实站点**；session 凭证文件测试前备份、结束后原样恢复。运行方式与新增用例见 [docs/开发指南.md](docs/开发指南.md)。
