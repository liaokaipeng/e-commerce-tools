# AGENTS.md

本文件为 AI 代理（及人类协作者）提供仓库工作上下文。请先通读再动手；**细则不写在本文件**——本文件只保留「约束 + 红线 + 指针」，细节一律见下方文档地图（同一事实只写一处，见约束 10）。

## 仓库概览

本仓库为**电商工具箱（shopee-tools-all-in-one）**：单服务、单端口（8765），前端为多页构建（8 个 HTML 入口 = 门户页 + 7 个功能页），门户页以常驻 iframe 按 Tab 切换，提供多个工具（TikTok 无水印下载 / Shopee 竞价导出 / Shopee 取消竞价 / Shopee 取消注册 Hot Listing / Shopee 视频批量上传）的本地 Node HTTP 服务。视频上传在门户页按站点拆「跨境」「本土」两个 Tab（共用 `/video/` 页面，`?mode=cn|ph` 固定站点）；「取消Hot Listing」Tab（`/hotlisting-cancel/`）按 SPU 批量取消注册已注册 SKU（复用竞价 Cookie）；「开放平台」Tab（`/openapi/`）负责 App 配置与店铺 OAuth 授权，为官方 Open API 功能统一提供登录与调用入口；「监控大屏」Tab（`/monitor/`）对已授权店铺定时巡检（订单/商品/健康/广告/资金/售后评价六域），P0/P1/P2 三级告警（仅在大屏展示，不接 IM）。

## 文档地图（先查再动手）

| 文档 | 唯一负责的内容 |
|---|---|
| [docs/架构.md](docs/架构.md) | 总体架构、目录结构、**API 路由总表**、取消类链路要点；**后端共享层约定（§3）与设计令牌细则（§4）的唯一权威** |
| [docs/视频上传链路.md](docs/视频上传链路.md) | 视频上传链路全部细节（站点 / 凭证 / 签名 / 流式 / Job / 取消 / 幂等） |
| [docs/开放平台链路.md](docs/开放平台链路.md) | OAuth 流程、v2 签名、**token 刷新与失效语义的唯一权威** |
| [docs/监控大屏实现.md](docs/监控大屏实现.md) | 监控按需采集调度、六域采集口径、金额换算、告警引擎与存储 |
| [docs/监控大屏.md](docs/监控大屏.md) | 监控大屏的使用者说明（完整口径、指标表、告警怎么读） |
| [docs/开发指南.md](docs/开发指南.md) | 快速开始、新增工具步骤、**测试与调试（含测试假失败的坑）的唯一权威** |
| [docs/GitHub提交与发布指南.md](docs/GitHub提交与发布指南.md) | 提交代码、发布 Release 与 `update.json` 清单的流程与坑（发布方视角） |
| [新手入门指南.md](新手入门指南.md) | 最终用户操作，**必须自包含**（见约束 9） |
| [docs/shopee_api_doc/README.md](docs/shopee_api_doc/README.md) | Shopee 开放平台官方文档整站目录与抓取方式 |

## 关键约束（务必遵守）

1. **极简零配置**，双击 `启动.bat` 即用，不加环境变量/额外安装步骤。
2. **后端不新增运行时依赖**；前端新增依赖需同步更新 `frontend/package.json` 与 `docs/架构.md`。
3. **接口还原，不用 UI 自动化**：直接调 Shopee 内部 HTTP 接口，遵循抓包链路；不要改成 Playwright/Selenium。
4. **端口固定 8765**，扩展与文档已硬编码。
5. **凭证不入库**，日志不完整打印 Cookie/Authorization。
6. **中文优先**，文档/注释/用户文案用中文，代码标识符可英文。
7. 改入口/端口/结构时，同步更新 `启动.bat`、`docs/架构.md`、`AGENTS.md`，及涉及的具体链路文档 / `docs/开发指南.md`。
8. 不主动新增文档文件，用现有 9 份（见文档地图；用户明确要求新增文档时除外）；Shopee 开放平台接口资料统一放 `docs/shopee_api_doc/`（刷新方式见其 README）。
9. **`新手入门指南.md` 必须自包含**：面向最终用户，**不得链接其它文档**，使用者要看的操作步骤、前提与常见问题都要写在这一个文件里。
10. **同一事实只写一处**：细则归上表列出的负责文档，其它文档只写红线与指针；**不要在本文件复述细则**（复述过的必然随实现漂移）。唯一例外是 `新手入门指南.md`（约束 9）——它内联的用户可见口径（如监控阈值、告警级别）变化时，需与负责文档手工同步两处。

## 技术栈速查（细则见 [docs/架构.md](docs/架构.md) §3–§4）

- 后端一律 **CommonJS**（`require`/`module.exports`）；前端 **Vue3 SFC**。改代码时保持文件原有风格，不混用。
- **后端不新增运行时依赖**（现仅 `exceljs` / `https-proxy-agent` / `socks-proxy-agent`）；前端现为 `vue` / `element-plus` / `vite` / `echarts`（监控大屏折线图，按需引入）。
- **共享层必须复用，不许各写一份**：会话/请求层 `lib/shopee-session.js`、JSON body `lib/http-utils.js`、端口 `lib/config.js`、长任务 `lib/jobs.js`、重试 `lib/retry.js`、导出落盘 `lib/export-utils.js`、统一出站 `lib/http.js`；前端对应 `bootstrap.js` / `composables/` / `components/` / `styles/base.css`。**各函数语义与「为什么不能绕过」见 [docs/架构.md](docs/架构.md) §3–§4，改前先读那一节。**
- **样式一律取设计令牌，不写死颜色与尺寸**：浅色取 `styles/base.css` 的 `:root`，深色取 `monitor/monitor.css` 的 `--d-*`；两个硬约束（深色令牌必须挂 `html`、ECharts 文字色在 `monitor/trend-chart.js`）见 [docs/架构.md](docs/架构.md) §4。
- **CORS 是本机白名单**（`main.js` 的 `isAllowedOrigin`），**不要退回 `Access-Control-Allow-Origin: *`**。
- 改前端 `src` 后必须 `vite build` 重建 `frontend/dist`（gitignored 产物）；新增共享模块后逐个确认调用方已 `require`（`grep -n "require('./lib/xxx')" server/*.js`），遗忘表现为路由 500。

## 关键注意点（红线一句话，细节见各自链路文档）

- **取消类链路（取消竞价 / Hot Listing）**：只处理资格正常的行；前端 SPU 配置区只渲染已选店铺，但 `spuMap` 必须**全量**回传（少传键＝删配置）。细节见 [docs/架构.md](docs/架构.md) §1.2。
- **视频上传**：**写操作必须 `call({ idempotent:false })`**，否则失败重放会「重复合并 / 发两条视频」；大文件必须流式，不得整文件 `readFileSync`。详见 [docs/视频上传链路.md](docs/视频上传链路.md) §8。
- **开放平台**：**刷新一律走 `ensureFresh` / `refreshShopNow`，绝不逐店遍历刷新**——单店刷新共享 token 组会作废组内其它店铺的 refresh_token，把整组拖成「需重新授权」；官方功能统一经 `callOpenApi`，不自行拼签名。详见 [docs/开放平台链路.md](docs/开放平台链路.md) §3。
- **监控大屏**：金额阈值一律按人民币配置与比较；规则阈值「留空 = 该级别不触发」必须用 `null` 传递（前端空值转 `null`，否则默认阈值会「复活」）；系统自检告警同样受规则 `enabled` 约束。详见 [docs/监控大屏实现.md](docs/监控大屏实现.md) §4。
- **开放平台接口报参数错误时**（error_param / 格式错 / Wrong sign / error_unknown）：网关报错文案经常是误导性的，**先查 `docs/shopee_api_doc/` 核对参数名与必填项，再用最小参数组合逐变体验证**，不要按字面改——完整排查顺序见 [docs/开发指南.md](docs/开发指南.md) §5.1。
- **版本与自更新**：`server/data/`（真实店铺授权）**绝不能进发布包，也绝不能被一键更新覆盖**；更新只按 `server/update.js` 的 `COPY_ITEMS` 白名单覆盖，落盘后必须重启才生效。流程与约束见 [docs/架构.md](docs/架构.md) §1.3。

## 经验沉淀（踩坑即记）

开发过程中如果 agent 走了弯路（排查方向错误、被报错文案误导、踩到环境/接口的坑），解决后应把经验沉淀回本仓库文档，避免重复踩坑：

- **记什么**：只记可复用的结论——坑的触发条件、正确做法、背后的原因，不要记排查流水账。
- **记在哪**：按文档地图的「唯一负责的内容」投递——共享层/约定 → `docs/架构.md` §3–§4；测试 → `docs/开发指南.md`；某条链路 → 对应链路文档；本机执行环境 → 本文件「本机环境坑」。
- **怎么记**：每条一两句话，给出可执行的规则（如「X 场景必须用 Y，因为 Z」）；过时或已被修复的条目及时删除，保持文档精炼。

## 本机环境坑（agent 执行环境，跑命令前先看）

本机为 Windows，shell 行为与常规 Linux 环境不同；以下坑已反复踩过，直接按推荐做法执行：

- **bash 与 PowerShell 都可能不可靠**：bash 的 `ls` / `grep` / `tail` / `rm` 常报 `command not found`（exit 127）；PowerShell 常只返回 exit 0、stdout 为空，`>` / `Out-File` 重定向会产出 UTF-16/GBK 乱码文件（Read 报 binary）。**要看命令输出就让命令自己写文件**（node 脚本里 `fs.writeFileSync(..., 'utf8')`），再用 Read 工具读。
- **删文件别用 `rm`**：会被安全删除 shim 拦截（按累计删除数计，超 50 报 `SAFE_DELETE_BULK_CONFIRM_REQUIRED`，批量清目录必失败）。单文件用 `[System.IO.File]::Delete('<绝对路径>')`，清整个目录用 `[System.IO.Directory]::Delete('<绝对路径>', $true)`，测试内零散删除走 `test/helpers.js` 的 `removeFile()`。
- **批量校验语法别写 for 循环**：bash 循环体内命令不可用时 exit code 仍是 0，错误被静默吞掉。写成 `node --check a.js && node --check b.js && echo OK`（`&&` 串联 + 末尾显式回显确认）。
- **前端没有自动化测试**：`vite build` 只保证编译期正确，拦不住 prop 名写错 / 模板变量未定义这类运行时错误，改完前端要跑页面级验证（cdp-page-verify 技能）；本机 8765 常被用户已启动的服务占用，先探端口，别杀用户的服务。
- **冒烟 `/monitor/` 前必须屏蔽 `POST /api/monitor/presence`**（CDP `Network.setBlockedURLs`）：该接口触发按需巡检，不屏蔽等于替用户对全部已授权店铺发起一轮真实采集；其余监控接口是只读的，照常请求即可。

## 测试

`node test/test.js`（或 `npm test`）：单元（`test/unit.test.js` 编排 `test/unit/` 按主题拆分）+ 开放平台刷新链路（`test/openapi-refresh.test.js`，离线 mock 网关）+ 接口冒烟（`test/api.test.js`，临时端口 8865），**不访问真实站点**；session 凭证文件测试前备份、结束后原样恢复。

**测试假失败的三个坑（数据目录隔离 / 金额断言先钉汇率 / mock 网关类测试清 `require.cache`）最容易误改代码**，动手前先读 [docs/开发指南.md](docs/开发指南.md) §4 的对应说明；运行方式与新增用例同样见该节。定位后端 500 用 `KP_TEST_SERVER_LOG=1 node test/test.js`。
