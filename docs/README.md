# 工具合集（shopee-tools-all-in-one）

单服务、单端口（8765）、单网页，提供四个工具：**TikTok 视频下载**、**Shopee 竞价导出**、**Shopee 取消竞价**、**Shopee 视频批量上传**（门户页按站点拆分为「跨境视频上传」「本土视频上传」两个 Tab），另加「**开放平台**」Tab：录入 App 后生成授权链接完成店铺授权、管理 Token，为后续官方 Open API 功能统一提供登录与调用入口。

> 面向最终用户的操作教程见《[新手入门指南](../新手入门指南.md)》；面向开发者的架构与目录结构见《[架构](架构.md)》；开发流程与测试见《[开发指南](开发指南.md)》；Shopee 开放平台接口资料（开发者指南 / API 参考整站目录，中文版）见 [shopee_api_doc/README.md](../shopee_api_doc/README.md)。本文件为仓库概览与快速开始。

## 技术栈

- 后端：Node.js ≥ 18，**CommonJS**
- 前端：**Vue3 + Element Plus + Vite** 多页（`frontend/`），构建产物 `frontend/dist` 由后端托管
- 扩展：**Manifest V3**（`extension/`），名「KP工具合集助手」，负责竞价 Cookie 推送与视频上传凭证抓取
- 依赖：后端 `exceljs` / `https-proxy-agent` / `socks-proxy-agent`；前端 `vue` / `element-plus` / `vite`

## 快速开始

```bash
npm i
node server/main.js              # 后端 http://127.0.0.1:8765
node test.js                     # 测试（单元 + 接口冒烟，临时端口 8865）

cd frontend && npm install && npm run dev    # 前端开发 http://localhost:5173（/api 代理到 8765）
cd frontend && npm run build                 # 构建到 frontend/dist，由 main.js 托管
```

日常使用双击 `启动.bat`（首次装依赖 + 构建前端 + 起服务 + 自动开浏览器）。

## 后端 API 一览

| 模块 | 路由 |
|------|------|
| server/main.js | `GET/POST /api/settings`、`GET /api/browse` |
| server/tiktok.js | `GET /api/tiktok/status`、`POST /api/download`、`POST /api/open-dir` |
| server/bidding.js | `GET /api/status`、`GET /api/stores`、`POST /api/export`、`POST /api/cookie` |
| server/bidding-cancel.js | `POST /api/bidding-cancel/preview`（扫描待改进竞价）、`POST /api/bidding-cancel/run`（SSE 逐条撤销） |
| server/video.js | `POST /api/start`、`GET /api/events`（SSE）、`POST /api/cancel`、`GET/POST /api/creds` |
| server/openapi.js | `GET /api/openapi/status`、`POST /api/openapi/app` `/auth-url` `/auth-callback` `/refresh` `/remove-shop` `/test`、`GET /openapi/callback` |

凭证由扩展自动抓取保存，页面无需手填。上传链路、流式处理、SSE 与任务取消等细节见《[架构](架构.md)》。

## 约定

- 端口固定 **8765**。
- 凭证不入库：`bidding-session.json` / `video-session.json` / `openapi-session.json` / `settings.json` 均 gitignored（统一存放在 `server/data/`）。
- 后端保持 CommonJS，前端用 Vue SFC。
- Shopee 开放平台接口资料统一放在 `shopee_api_doc/`（官方文档整站目录中文整理版，更新方式见 [shopee_api_doc/README.md](../shopee_api_doc/README.md)）。
- 改入口 / 端口 / 结构时，同步更新 `启动.bat`、`docs/README.md`、`docs/架构.md`、`AGENTS.md`。
