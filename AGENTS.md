# AGENTS.md

本文件为 AI 代理（及人类协作者）提供仓库工作上下文。请先通读再动手。

## 仓库概览

本仓库为**工具合集（shopee-tools-all-in-one）**：单服务、单端口（8765）、单网页，提供三个工具（TikTok 无水印下载 / Shopee 竞价导出 / Shopee 视频批量上传）的本地 Node HTTP 服务 + 一个前端门户页，按 Tab 切换使用。

> 项目结构、技术栈、后端 API、构建方式见 [README.md](README.md)；最终用户操作见 [新手入门指南.md](新手入门指南.md)。

## 技术栈关键点

- 后端一律 **CommonJS**（`require`/`module.exports`）；前端用 **Vue3 SFC**。改代码时保持文件原有风格，不混用。
- 后端依赖仅 `exceljs` / `https-proxy-agent` / `socks-proxy-agent`；前端仅 `vue` / `element-plus` / `vite`。
- 视频上传支持多站点（cn 跨境分片+merge / ph 菲律宾单次 PUT+task），凭证按站点存 `video-session.json`；跨境需 Shop ID、菲律宾需 User ID。
- 扩展「KP工具合集助手」（MV3）负责竞价 Cookie 推送（`/api/cookie`）与视频上传凭证按站点抓取（`/api/creds`）。

## 约定与约束

1. **极简零配置**，双击 `启动.bat` 即用，不加环境变量/额外安装步骤。
2. **不新增运行时依赖**。
3. **接口还原，不用 UI 自动化**：直接调 Shopee 内部 HTTP 接口，遵循抓包链路；不要改成 Playwright/Selenium。
4. **端口固定 8765**，扩展与文档已硬编码。
5. **凭证不入库**，日志不完整打印 Cookie/Authorization。
6. **中文优先**，文档/注释/用户文案用中文，代码标识符可英文。
7. 改入口/端口/结构时，同步更新 `启动.bat`、`README.md`、`AGENTS.md`。
8. 不主动新增文档文件，用现有 `README.md` / `新手入门指南.md` / `AGENTS.md`。

## 测试

- `node test.js`：冒烟测试（临时端口 8865，验页面与 API 路由，不访问真实站点），全部通过即正常。
- 其余无自动化：TikTok 下载 / 竞价导出 / 视频上传按真实流程手测。