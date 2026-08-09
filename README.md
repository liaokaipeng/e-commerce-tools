# 工具合集（shopee-tools-all-in-one）

单服务、单端口（8765）、单网页，提供三个工具：**TikTok 视频下载**、**Shopee 竞价导出**、**Shopee 视频批量上传**。

> 面向最终用户的操作教程见《[新手入门指南](新手入门指南.md)》。本文档面向开发者。

## 技术栈

- 后端：Node.js ≥ 18，**CommonJS**
- 前端：**Vue3 + Element Plus + Vite** 多页（`frontend/`），构建产物 `frontend/dist` 由后端托管
- 扩展：**Manifest V3**（`extension/`），名「KP工具合集助手」，负责竞价 Cookie 推送与视频上传凭证抓取
- 依赖：后端 `exceljs` / `https-proxy-agent` / `socks-proxy-agent`；前端 `vue` / `element-plus` / `vite`

## 快速开始

```bash
npm i
node main.js                      # 后端 http://127.0.0.1:8765
node test.js                      # 冒烟测试（临时端口 8865）

cd frontend && npm install && npm run dev    # 前端开发 http://localhost:5173（/api 代理到 8765）
cd frontend && npm run build                 # 构建到 frontend/dist，由 main.js 托管
```

日常使用双击 `启动.bat`（首次装依赖 + 构建前端 + 起服务 + 自动开浏览器）。

## 目录结构

```
shopee/
  main.js           后端入口（单端口路由 + 静态托管 + 目录浏览/默认目录设置）
  bidding.js        Shopee 竞价导出模块
  video.js          Shopee 视频上传模块（多站点上传链路）
  tiktok.js         TikTok 下载核心模块
  stores.json       竞价店铺列表（分类/名称/ID，可直接增删）
  test.js           冒烟测试（临时端口 8865）
  lib/
    http-utils.js   通用 HTTP 工具（sendJson / serveStatic / readBody）
    http.js         统一出站请求封装（按 host 维护 Cookie 罐）
    settings.js     默认目录持久化（运行时生成 settings.json，不入库）
  extension/        浏览器扩展（manifest / background / popup）
  frontend/         Vue 多页前端工程（portal/tiktok/bidding/video + dist）
  新手入门指南.md   面向最终用户的操作教程
  启动.bat          一键启动
```

## 后端 API

| 模块 | 路由 |
|------|------|
| main.js | `GET/POST /api/settings`、`GET /api/browse` |
| tiktok.js | `GET /api/tiktok/status`、`POST /api/download`、`POST /api/open-dir` |
| bidding.js | `GET /api/status`、`GET /api/stores`、`POST /api/export`、`POST /api/cookie` |
| video.js | `POST /api/start`、`GET /api/events`（SSE）、`GET/POST /api/creds`、`GET /api/stores` |

## 浏览器扩展

`extension/` 一个扩展同时负责：

- **竞价**：popup 点「发送登录信息到本地工具」→ 推 Cookie 到 `/api/cookie`。
- **视频上传**：background 监听 `webRequest`，按站点（跨境 .cn / 本土 .ph 等）抓取凭证 → 推 `/api/creds`，存 `video-session.json`。host_permissions 覆盖 `shopee.ph / shopee.sg / shopee.com.my / usercontent.com` 等域。

## 约定

- 端口固定 **8765**。
- 凭证不入库：`bidding-session.json` / `video-session.json` / `settings.json` 均 gitignored。
- 后端保持 CommonJS，前端用 Vue SFC。
- 改入口 / 端口 / 结构时，同步更新 `启动.bat`、`README.md`、`AGENTS.md`。