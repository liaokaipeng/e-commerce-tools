# AGENTS.md

本文件为 AI 代理（及人类协作者）提供仓库工作上下文。请先通读再动手；细节以各文档为准，先查再改。

## 仓库概览

本仓库为**工具合集（shopee-tools-all-in-one）**：单服务、单端口（8765）、单网页，提供四个工具（TikTok 无水印下载 / Shopee 竞价导出 / Shopee 取消竞价 / Shopee 视频批量上传）的本地 Node HTTP 服务 + 一个前端门户页，按 Tab 切换使用。视频上传在门户页按站点拆「跨境」「本土」两个 Tab（共用 `/video/` 页面，`?mode=cn|ph` 固定站点）；「开放平台」Tab（`/openapi/`）负责 App 配置与店铺 OAuth 授权，为官方 Open API 功能统一提供登录与调用入口；「监控大屏」Tab（`/monitor/`）对已授权店铺定时巡检（订单/商品/健康/广告/资金/售后评价六域），P0/P1/P2 三级告警（仅在大屏展示，不接 IM）。

## 文档地图（先查再动手）

- 总体架构、目录结构、API 路由总表与约定：[docs/架构.md](docs/架构.md)
- 视频上传链路：[docs/视频上传链路.md](docs/视频上传链路.md)
- 开放平台登录链路：[docs/开放平台链路.md](docs/开放平台链路.md)
- 监控大屏实现（开发者）：[docs/监控大屏实现.md](docs/监控大屏实现.md)
- 监控大屏使用（使用者）：[docs/监控大屏.md](docs/监控大屏.md)
- 开发流程、快速开始与测试：[docs/开发指南.md](docs/开发指南.md)
- 最终用户操作：[新手入门指南.md](新手入门指南.md)
- Shopee 开放平台接口资料：[shopee_api_doc/README.md](shopee_api_doc/README.md)

## 关键约束（务必遵守）

1. **极简零配置**，双击 `启动.bat` 即用，不加环境变量/额外安装步骤。
2. **后端不新增运行时依赖**；前端新增依赖需同步更新 `frontend/package.json`、本文件技术栈速查与 `docs/架构.md`（当前前端含 echarts，用于监控大屏折线图）。
3. **接口还原，不用 UI 自动化**：直接调 Shopee 内部 HTTP 接口，遵循抓包链路；不要改成 Playwright/Selenium。
4. **端口固定 8765**，扩展与文档已硬编码。
5. **凭证不入库**，日志不完整打印 Cookie/Authorization。
6. **中文优先**，文档/注释/用户文案用中文，代码标识符可英文。
7. 改入口/端口/结构时，同步更新 `启动.bat`、`docs/架构.md`、`AGENTS.md`，及涉及的具体链路文档 / `docs/开发指南.md`。
8. 不主动新增文档文件，用现有 8 份（见上文文档地图；用户明确要求新增文档时除外）；Shopee 开放平台接口资料统一放 `shopee_api_doc/`（刷新方式见其 README）。

## 技术栈速查

- 后端一律 **CommonJS**（`require`/`module.exports`）；前端用 **Vue3 SFC**。改代码时保持文件原有风格，不混用。
- 后端依赖仅 `exceljs` / `https-proxy-agent` / `socks-proxy-agent`；前端依赖 `vue` / `element-plus` / `vite` / `echarts`（监控大屏折线图，按需引入）。
- 前端共享代码优先复用：各页入口统一经 `frontend/src/bootstrap.js` 挂载；`composables/useToolPage.js`、`useShopeeSession.js`、`components/`（LogPanel/DirRow/LoginCard/StorePicker）、公共样式 `styles/base.css`（monitor 深色页不用）。
- `tiktok.js` / `video.js` / `openapi.js` / `monitor.js` 只做路由注册，链路拆到 `server/tiktok/` / `server/video/` / `server/openapi/` / `server/monitor/` 子模块；新增逻辑放对应子模块，不要塞回入口文件。

## 关键注意点（细节见对应链路文档）

- 取消竞价：`get_item_ongoing_list`（`filter.page_tab=2` 待改进，`page_tab=1` 进行中全部）+ `seller_withdraw`（body `{ bid_id }`）逐条撤销；与竞价导出共用 `bidding-session.json` 与 `stores.json`。
- 视频上传：cn 跨境分片+merge / ph 菲律宾单次 PUT+task；**solutions 成功码 200000（非 0），有 post_id 即发布成功**；跨境凭证唯一入口 `resolveCnAuth`；大文件**流式处理**，不得整文件 `readFileSync`；任务可取消（`POST /api/cancel`），取消造成的中断不重试；SSE 按 job 缓存迟到自动回放。详见 [docs/视频上传链路.md](docs/视频上传链路.md)。
- 开放平台：签名 `base = partner_id + api_path + timestamp（+ access_token + shop_id）`、`sign = HMAC-SHA256(partner_key, base)` 小写 hex；**查询类接口（get_*/search_*）用 GET、写操作/换 token 用 POST**；`access_token/get` 刷新特殊；刷新结果绑定发起刷新的店铺、不跨店传播（FAQ138 Q8）。后续官方 Open API 功能统一经 `server/openapi/client.js` 的 `callOpenApi(apiPath, 业务参数, { shopId })`，不要自行拼签名或管理 token。详见 [docs/开放平台链路.md](docs/开放平台链路.md)。
- 监控大屏：**按需采集**（仅大屏打开时巡检）；域频率：订单 10 分钟 / 商品 30 分钟 / 健康·广告·资金·售后 60 分钟；**金额阈值一律按人民币配置与比较**；告警纯函数 `server/monitor/rules.js`、生命周期 `engine.js`，系统自检定级 1→P2、2→P1、≥5→P0；凭证失效店铺跳过采集并在大屏横幅提示重新授权。接口实测口径见 [docs/监控大屏实现.md](docs/监控大屏实现.md)，使用者视角见 [docs/监控大屏.md](docs/监控大屏.md)。
- 开放平台接口报参数错误时（error_param / 格式错 / Wrong sign / error_unknown）：网关报错文案经常是误导性的，**先查 `shopee_api_doc/` 核对参数名与必填项，再用最小参数组合逐变体验证**，不要按字面改——完整排查顺序见 [docs/开发指南.md](docs/开发指南.md) 5.1 节。

## 测试

`node test.js`（或 `npm test`）：单元（`test/unit.test.js`，纯函数 + 任务取消，不启动服务）+ 接口冒烟（`test/api.test.js`，临时端口 8865，含 SSE 迟到回放、任务取消与 404 兜底），**不访问真实站点**；session 凭证文件测试前备份、结束后原样恢复。运行方式与新增用例见 [docs/开发指南.md](docs/开发指南.md)。
