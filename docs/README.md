# 工具合集（shopee-tools-all-in-one）

单服务、单端口（8765）、单网页，提供三个工具：**TikTok 视频下载**、**Shopee 竞价导出**、**Shopee 视频批量上传**（门户页按站点拆分为「跨境视频上传」「本土视频上传」两个 Tab）。

> 面向最终用户的操作教程见《[新手入门指南](新手入门指南.md)》，面向开发者的架构与约定见《[开发指南](docs/开发指南.md)》。本文件为仓库概览。

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

## 目录结构

```
shopee/
  server/          后端（Node CommonJS）
    main.js        后端入口（单端口路由 + 静态托管 + 目录浏览/默认目录设置）
    bidding.js     Shopee 竞价导出模块（店铺列表热载自 config/stores.json）
    video.js       Shopee 视频上传模块（路由注册；链路拆到 video/ 子模块）
    tiktok.js      TikTok 下载核心模块
    video/         视频上传子模块（constants / request / creds / upload-cn / upload-ph / job）
    lib/
      http-utils.js   通用 HTTP 工具（sendJson / serveStatic / readBody / sse）
      http.js         统一出站请求封装（按 host 维护 Cookie 罐）
      settings.js     默认目录持久化（运行时生成 settings.json，不入库）
      video-utils.js  视频上传纯函数（哈希/etag/SigV4/AES 解密/MP4 探测/行校验，可独立单测）
    config/
      stores.json     竞价店铺列表（分类/名称/ID，可直接增删）
  test.js           测试入口（单元 + 接口冒烟，临时端口 8865，session 凭证文件原样备份恢复）
  test/             测试拆分：helpers.js（共享工具）/ unit.test.js（纯函数）/ api.test.js（路由冒烟）
  extension/        浏览器扩展（manifest / background / popup）
  frontend/         Vue 多页前端工程（portal/tiktok/bidding/video + dist；页面通用逻辑见 src/composables/useToolPage.js）
  docs/开发指南.md   面向开发者的架构、模块约定、扩展与测试说明
  新手入门指南.md   面向最终用户的操作教程
  启动.bat          一键启动
```

## 后端 API

| 模块 | 路由 |
|------|------|
| server/main.js | `GET/POST /api/settings`、`GET /api/browse` |
| server/tiktok.js | `GET /api/tiktok/status`、`POST /api/download`、`POST /api/open-dir` |
| server/bidding.js | `GET /api/status`、`GET /api/stores`、`POST /api/export`、`POST /api/cookie` |
| server/video.js | `POST /api/start`、`GET /api/events`（SSE）、`POST /api/cancel`、`GET/POST /api/creds` |

视频上传模块内置健壮性处理：出站请求对网络错误 / 超时 / 5xx 自动指数退避重试（最多 3 次，4xx 业务错不重试，避免重复副作用）；发布（`video/create` / `task/edit` / `task/post`）会校验业务错误码，不再把「HTTP 200 但业务失败」误报为成功（solutions 接口成功码为 200000）；跨境商品匹配对纯数字编码优先作精确匹配；SSE 任务事件按 job 缓存，迟到连接自动回放（任务先于浏览器连接结束也不丢事件，避免前端卡住）；**任务可取消**（`POST /api/cancel`：中断进行中的请求并停止后续行，前端上传中显示「取消上传」按钮）；**大文件流式读取**（哈希/分片/PUT 全程不整文件加载进内存，MP4 元信息用头尾采样探针解析）。

凭证由扩展自动抓取保存，页面无需手填：跨境（.cn）上传凭证为账号级通用（任一店铺手动上传一次即可供同账号所有店铺使用），统一经 `resolveCnAuth` 解析（优先本地已抓凭证中有效期最长者 → 兜底 Cookie 换取 → 报错引导手动上传）。

## 浏览器扩展

`extension/` 一个扩展同时负责：

- **竞价**：popup 点「发送登录信息到本地工具」→ 推 Cookie 到 `/api/cookie`。
- **视频上传**：background 监听 `webRequest`，按站点（跨境 .cn / 本土 .ph）抓取凭证 → 推 `/api/creds`，存 `video-session.json`。凭证同时缓存在 `chrome.storage.local`，本地服务未启动时不丢，下次抓到新请求时**整包重推全部站点/店铺**（因此手动清空 `server/data/video-session.json` 后一刷新虾皮页面会被自动写回）。host_permissions 覆盖 `shopee.cn / shopee.ph` 域。

## 约定

- 端口固定 **8765**。
- 凭证不入库：`bidding-session.json` / `video-session.json` / `settings.json` 均 gitignored（统一存放在 `server/data/`）。
- 后端保持 CommonJS，前端用 Vue SFC。
- 改入口 / 端口 / 结构时，同步更新 `启动.bat`、`docs/README.md`、`AGENTS.md`。