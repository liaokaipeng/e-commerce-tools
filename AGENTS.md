# AGENTS.md

本文件为 AI 代理（及人类协作者）提供仓库工作上下文。请先通读再动手；细节以各文档为准，先查再改。

## 仓库概览

本仓库为**工具合集（shopee-tools-all-in-one）**：单服务、单端口（8765），前端为多页构建（8 个 HTML 入口 = 门户页 + 7 个功能页），门户页以常驻 iframe 按 Tab 切换，提供多个工具（TikTok 无水印下载 / Shopee 竞价导出 / Shopee 取消竞价 / Shopee 取消注册 Hot Listing / Shopee 视频批量上传）的本地 Node HTTP 服务。视频上传在门户页按站点拆「跨境」「本土」两个 Tab（共用 `/video/` 页面，`?mode=cn|ph` 固定站点）；「取消Hot Listing」Tab（`/hotlisting-cancel/`）按 SPU 批量取消注册已注册 SKU（复用竞价 Cookie）；「开放平台」Tab（`/openapi/`）负责 App 配置与店铺 OAuth 授权，为官方 Open API 功能统一提供登录与调用入口；「监控大屏」Tab（`/monitor/`）对已授权店铺定时巡检（订单/商品/健康/广告/资金/售后评价六域），P0/P1/P2 三级告警（仅在大屏展示，不接 IM）。

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
- 前端共享代码优先复用：各页入口统一经 `frontend/src/bootstrap.js` 挂载；`composables/useToolPage.js`（含统一 SSE 请求样板 `runSSE`）、`useShopeeSession.js`、`useBatchJob.js`（长任务：进度/暂停继续取消/行状态回填，取消竞价与取消 Hot Listing 共用）、`components/`（LogPanel/DirRow/DirPicker/LoginCard/StorePicker/PreviewTableCard）、公共样式 `styles/base.css`（monitor 深色页不用）。
- 监控大屏页（`frontend/src/monitor/`）内部分层：`App.vue` 只做编排，状态/接口/SSE/在场心跳在 `useMonitor.js`，展示拆 `MonitorHeader` / `ShopWall` / `CenterPanels` / `AlertStream` / `MonitorFooter` / `MonitorDrawers` 六个组件，常量纯函数在 `constants.js`、ECharts option 在 `trend-chart.js`；样式 `monitor.css` 是**页面级（非 scoped）**（独立 HTML 文档不外泄，共用类只定义一次），改样式别改回 scoped。
- 后端共享代码优先复用：**竞价导出 / 取消竞价 / 取消 Hot Listing**三个模块的会话读取、Cookie 组装、登录态断言、店铺列表、金额换算、**接口请求层（`buildShopeeUrl` / `apiGet` / `apiPost` / `fetchShopRegion`）**统一走 `server/lib/shopee-session.js`，不要各自复制、也不要硬编码 `https://seller.shopee.cn`（用导出的 `HOST`）；**导出落盘**（默认「下载」目录、文件名时间戳、Excel 表头样式）统一走 `server/lib/export-utils.js`；**路由 JSON 请求体统一用 `lib/http-utils` 的 `readJsonBody`（严格，非法即抛）/ `readRouteBody`（宽容，记 warn 后返回 `{}`；传 `{ res }` 时非法 body 回 400，控制类接口用；`readJsonBodySoft` 是它的别名）/ `jsonAction`（body 当业务参数、内部异常统一回 400）**，不要再各写 `JSON.parse(await readBody(req))` 样板（唯一例外：`/api/cookie` 为扩展对接协议，返回纯文本）；端口等全局常量统一走 `server/lib/config.js`（`LISTEN_PORT` 可被 `PORT` 覆盖，`CALLBACK_PORT` 固定 8765）。
- `tiktok.js` / `video.js` / `openapi.js` / `monitor.js` 只做路由注册，链路拆到 `server/tiktok/` / `server/video/` / `server/openapi/` / `server/monitor/` 子模块；新增逻辑放对应子模块，不要塞回入口文件。
- **长任务（批量操作类）统一走 `server/lib/jobs.js`**：暂停 / 继续 / 取消 / SSE 客户端断开即取消 / TTL 僵尸清理都在这里，执行体只在关键步骤间 `await jobs.checkpoint(jobId, isAborted)`（被取消抛 `CancelledError`、被暂停则挂起）；**不要再各写一份 jobs Map + waitIfPaused 循环**。前端配套 `composables/useBatchJob.js`。
- **重试 / 退避统一走 `server/lib/retry.js`**：`retry(fn, { attempts, waitOf, shouldRetry, onRetry, isAborted })` + 三种策略（`exponentialBackoff` 网络/5xx、`fixedBackoff` 上游限流、`jitteredLinearBackoff` 防风控）；新增链路不要再手写重试循环。
- **CORS 白名单（`server/main.js` 的 `isAllowedOrigin`）**：只放行本机来源（`http(s)://127.0.0.1|localhost[:端口]`）与浏览器扩展（`chrome-extension://` / `moz-extension://`），其余带 Origin 的请求一律 403。新增前端调试来源需同步改这里，**不要退回 `Access-Control-Allow-Origin: *`**。

## 关键注意点（细节见对应链路文档）

- 取消竞价：`get_item_ongoing_list`（`filter.page_tab=2` 待改进，`page_tab=1` 进行中全部）+ `seller_withdraw`（body `{ bid_id }`）逐条撤销；与竞价导出共用 `bidding-session.json` 与 `stores.json`；同样支持暂停/继续/取消（`POST /api/bidding-cancel/pause|resume|cancel`，实现与 Hot Listing 一致，走 `lib/jobs.js`）。
- 取消注册 Hot Listing（`server/hotlisting-cancel.js`）：与取消竞价同模式（预览 + SSE 执行），执行中可暂停 / 继续 / 取消：run 首事件 `start` 下发 `jobId`，前端经 `POST /api/hotlisting-cancel/pause|resume|cancel`（body `{ jobId }`）控制，后端在各店铺/SPU/SKU 步骤间经 `server/lib/jobs.js` 的 `checkpoint` 门控（暂停挂起、取消抛 `CancelledError` 并以 `cancelled` 事件收尾）；**SSE 客户端断开即视为取消**（本地单人工具，关页面＝不想继续），任务另有 30 分钟 TTL 兜底清理。每个店铺配 1 个 SPU ID（单行输入，`parseSpuList` 仍兼容多值），持久化到 `server/data/hotlisting-spu.json`（`GET/POST /api/hotlisting-cancel/spu-config`，前端编辑后防抖自动保存）；`POST /api/mkt/buybox/get_rsku_vsku_list`（`from_condition.spu_id` + `search_filter.rsku_status=2` 已注册 + `page_info.offset/limit` 翻页）+ `POST /api/mkt/buybox/update_enroll`（body `{ rsku_id, vsku_id, seller_decision: 0 }`）；**只取消 `seller_decision=1` 且 `qualification_flags=1` 的行**（=0 为资格异常行如 stock_unqualified，无法取消注册，须过滤）；公共查询参数 `SPC_CDS_VER=2&SPC_CDS=<Cookie值>&cnsc_shop_id&cbsc_shop_region`。
- 视频上传：cn 跨境分片+merge / ph 菲律宾单次 PUT+task；**solutions 成功码 200000（非 0），有 post_id 即发布成功**；跨境凭证唯一入口 `resolveCnAuth`；大文件**流式处理**，不得整文件 `readFileSync`；任务可取消（`POST /api/cancel`），取消造成的中断不重试；SSE 按 job 缓存迟到自动回放。详见 [docs/视频上传链路.md](docs/视频上传链路.md)。
- 开放平台：签名 `base = partner_id + api_path + timestamp（+ access_token + shop_id）`、`sign = HMAC-SHA256(partner_key, base)` 小写 hex；**查询类接口（get_*/search_*）用 GET、写操作/换 token 用 POST**；`access_token/get` 刷新特殊；**刷新一律走 `ensureFresh` / `refreshShopNow`（内含 `planRefresh` 分组决策）：共享主账号 token 的店铺整组续期，独立凭证只写回本店**——单店刷新共享组会作废其余店铺的 refresh_token、导致整组被判「需重新授权」（FAQ138 Q8），不要直接调 `refreshToken`。后续官方 Open API 功能统一经 `server/openapi/client.js` 的 `callOpenApi(apiPath, 业务参数, { shopId })`，不要自行拼签名或管理 token。详见 [docs/开放平台链路.md](docs/开放平台链路.md)。
- 监控大屏：**按需采集**（仅大屏打开时巡检）；域频率：订单 10 分钟 / 商品 30 分钟 / 健康·广告·资金·售后 60 分钟；**金额阈值一律按人民币配置与比较**；告警纯函数 `server/monitor/rules.js`、生命周期 `engine.js`，系统自检定级 1→P2、2→P1、≥5→P0；凭证失效店铺跳过采集并在大屏横幅提示重新授权。**规则阈值「留空 = 该级别不触发」用 `null` 传递**（`mergeRules` 遇 `null` 删除该级别，前端 `saveRules` 必须把空值统一转 `null`，否则默认阈值会「复活」）；**系统自检告警同样受规则 `enabled` 开关约束**（关闭后既有告警自动收尾为已恢复）。接口实测口径见 [docs/监控大屏实现.md](docs/监控大屏实现.md)，使用者视角见 [docs/监控大屏.md](docs/监控大屏.md)。
- 开放平台接口报参数错误时（error_param / 格式错 / Wrong sign / error_unknown）：网关报错文案经常是误导性的，**先查 `shopee_api_doc/` 核对参数名与必填项，再用最小参数组合逐变体验证**，不要按字面改——完整排查顺序见 [docs/开发指南.md](docs/开发指南.md) 5.1 节。

## 经验沉淀（踩坑即记）

开发过程中如果 agent 走了弯路（排查方向错误、被报错文案误导、踩到环境/接口的坑），解决后应把经验沉淀回本文件，避免重复踩坑：

- **记什么**：只记可复用的结论——坑的触发条件、正确做法、背后的原因，不要记排查流水账。
- **记在哪**：属于共享层/约定的归入「技术栈速查」，属于具体链路的归入「关键注意点」，属于本机执行环境/工具链的归入「本机环境坑」；本文件已有条目能合并就合并，不重复开条目。
- **怎么记**：每条一两句话，给出可执行的规则（如「X 场景必须用 Y，因为 Z」）；过时或已被修复的条目及时删除，保持文件精炼。

## 本机环境坑（agent 执行环境，跑命令前先看）

本机为 Windows，shell 行为与常规 Linux 环境不同；以下坑已反复踩过，直接按推荐做法执行，不要再试错一遍：

- **bash PATH 异常（老坑）**：`ls` / `grep` / `tail` / `rm` 等常报 `command not found`（exit 127）。别死磕 bash，换 PowerShell 工具；PowerShell 也不可靠时（见下条）用 node 脚本兜底。
- **PowerShell 回显不可靠**：常只返回 exit 0、stdout 为空；`>` / `Out-File` 重定向会产出 UTF-16/GBK 乱码文件（Read 报 binary）。要看输出 → 让命令自己写文件（如 node 脚本里 `fs.writeFileSync(..., 'utf8')`），再用 Read 工具读。
- **删文件别用 `rm`**：会被安全删除 shim 拦截（按累计删除数计，超 50 报 `SAFE_DELETE_BULK_CONFIRM_REQUIRED`，批量清目录必失败）。单文件用 PowerShell `[System.IO.File]::Delete('<绝对路径>')`；清整个目录用 `[System.IO.Directory]::Delete('<绝对路径>', $true)`；测试内零散删除走 `test/helpers.js` 的 `removeFile()`。
- **批量校验语法别写 for 循环**：bash 循环体内命令不可用时 exit code 仍是 0，错误被静默吞掉。写成 `node --check a.js && node --check b.js && echo OK`（`&&` 串联 + 末尾显式回显确认）。
- **前端没有自动化测试**：`vite build` 只保证编译期正确，拦不住 prop 名写错 / 模板变量未定义这类运行时错误。页面级验证用 cdp-page-verify 技能；本机 8765 常被用户已启动的服务占用，先探端口，别杀用户的服务。

## 测试

`node test.js`（或 `npm test`）：单元（`test/unit.test.js`，纯函数 + 任务取消，不启动服务）+ 接口冒烟（`test/api.test.js`，临时端口 8865，含 SSE 迟到回放、任务取消与 404 兜底），**不访问真实站点**；session 凭证文件测试前备份、结束后原样恢复。运行方式与新增用例见 [docs/开发指南.md](docs/开发指南.md)。

测试假失败的已知坑（先排查这些，别急着改代码）：

- **数据目录必须隔离**：在 require 监控模块**之前**把 `process.env.MONITOR_DATA_DIR` 指到临时目录，否则会读到 `server/data/monitor/rules.json` 里用户真实保存的规则覆盖，阈值类断言随用户配置漂移。
- **金额断言必须先钉死汇率**：先调 `require('../server/monitor/currency')._test.lockStaticRatesForTest()`，否则当天在线汇率会让「500 泰铢 ≈ 105 元」这类断言随机失败。
- **定位后端 500**：`KP_TEST_SERVER_LOG=1 node test.js` 会把被测子进程 stderr 透传到测试输出。
