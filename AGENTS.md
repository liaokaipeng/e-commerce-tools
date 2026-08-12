# AGENTS.md

本文件为 AI 代理（及人类协作者）提供仓库工作上下文。请先通读再动手。

## 仓库概览

本仓库为**工具合集（shopee-tools-all-in-one）**：单服务、单端口（8765）、单网页，提供三个工具（TikTok 无水印下载 / Shopee 竞价导出 / Shopee 视频批量上传）的本地 Node HTTP 服务 + 一个前端门户页，按 Tab 切换使用。其中视频上传在门户页按站点拆分为「跨境视频上传」「本土视频上传」两个 Tab（共用 `/video/` 页面，经 `?mode=cn|ph` 固定站点）。

> 项目结构、技术栈、后端 API、构建方式见 [README.md](README.md)；最终用户操作见 [新手入门指南.md](新手入门指南.md)；面向开发者的架构与约定见 [docs/开发指南.md](docs/开发指南.md)。

## 技术栈关键点

- 后端一律 **CommonJS**（`require`/`module.exports`）；前端用 **Vue3 SFC**。改代码时保持文件原有风格，不混用。
- 后端依赖仅 `exceljs` / `https-proxy-agent` / `socks-proxy-agent`；前端仅 `vue` / `element-plus` / `vite`。
- 前端 tiktok/bidding 两页共用逻辑抽在 `frontend/src/composables/useToolPage.js`（默认目录设置 / 日志自动滚动 / SSE 流读取），改动时优先复用，不重复实现。
- 视频上传支持多站点（cn 跨境分片+merge / ph 菲律宾单次 PUT+task），凭证按站点存 `video-session.json`；跨境默认自动选定已抓凭证的店铺、可用「选择店铺」下拉框改选（凭证账号级通用，经 `resolveCnAuth` 统一解析）、菲律宾需 User ID。注意：solutions 接口成功码为 200000（非 0），有 post_id 即发布成功。
- 视频上传的纯函数（md5/etag/AES 解密/SigV4 签名/MP4 探测/行校验等）统一在 `lib/video-utils.js`，`video.js` 只管链路编排；新增此类逻辑放 lib 并补单测，不要塞回 video.js。
- SSE 任务事件按 job 缓存（`jobEvents`，上限 20 个任务），迟到连接自动回放：任务可能先于浏览器连接结束（如首行校验秒失败），无回放会让前端一直卡住。
- 扩展「KP工具合集助手」（MV3）负责竞价 Cookie 推送（`/api/cookie`）与视频上传凭证按站点抓取（`/api/creds`）；凭证缓存在 `chrome.storage.local`，抓到新请求时整包重推（故 `video-session.json` 清空后会被自动写回）。页面已不展示 Cookie/Authorization 输入框，凭证全靠扩展自动抓取。

## 约定与约束

1. **极简零配置**，双击 `启动.bat` 即用，不加环境变量/额外安装步骤。
2. **不新增运行时依赖**。
3. **接口还原，不用 UI 自动化**：直接调 Shopee 内部 HTTP 接口，遵循抓包链路；不要改成 Playwright/Selenium。
4. **端口固定 8765**，扩展与文档已硬编码。
5. **凭证不入库**，日志不完整打印 Cookie/Authorization。
6. **中文优先**，文档/注释/用户文案用中文，代码标识符可英文。
7. 改入口/端口/结构时，同步更新 `启动.bat`、`README.md`、`AGENTS.md`（涉及视频上传链路/测试结构时还应更新 `docs/开发指南.md`）。
8. 不主动新增文档文件，用现有 `README.md` / `新手入门指南.md` / `AGENTS.md` / `docs/开发指南.md`。

## 测试

- `node test.js`（或 `npm test`）：分两类，全部通过即正常（退出码 0），**不访问真实站点**。
  - **单元测试** `test/unit.test.js`：纯函数（`lib/video-utils.js` / tiktok 链接与代理 / 竞价金额换算），不启动服务。
  - **接口冒烟测试** `test/api.test.js`：临时端口 8865，验页面与 API 路由、SSE 端到端（含迟到回放）；session 凭证文件测试前备份、结束后原样恢复。
  - 共享工具在 `test/helpers.js`（`t` 断言 / `req` 封装 / `startServer` 启动与凭证备份恢复）。
- 其余无自动化：TikTok 下载 / 竞价导出 / 视频上传按真实流程手测。