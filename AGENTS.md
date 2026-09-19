# AGENTS.md

本文件为 AI 代理（及人类协作者）提供仓库工作上下文。请先通读再动手；**细则不写在本文件**——本文件只保留「约束 + 红线 + 指针」，细节一律见下方文档地图（同一事实只写一处，见约束 10）。

## 仓库概览

本仓库为**电商工具箱**：单服务、单端口（8765），前端为多页构建（9 个 HTML 入口 = 门户页 + 8 个功能页），门户页以常驻 iframe 按 Tab 切换，侧栏按「Shopee / TikTok / 其他」三组展示，提供多个工具（TikTok 无水印下载 / Shopee 竞价导出 / Shopee 取消竞价 / Shopee 取消注册 Hot Listing / Shopee 视频批量上传 / 视频压缩）的本地 Node HTTP 服务。视频上传在门户页按站点拆「跨境」「本土」两个 Tab（共用 `/video/` 页面，`?mode=cn|ph` 固定站点）；「取消Hot Listing」Tab（`/hotlisting-cancel/`）按 SPU 批量取消注册已注册 SKU（复用竞价 Cookie）；「开放平台」Tab（`/openapi/`）负责 App 配置与店铺 OAuth 授权，为官方 Open API 功能统一提供登录与调用入口；「监控大屏」Tab（`/monitor/`）对已授权店铺定时巡检（订单/商品/健康/广告/资金/售后评价六域），P0/P1/P2 三级告警（仅在大屏展示，不接 IM）；「其他」组的「视频压缩」Tab（`/compress/`）是**唯一纯本地、不访问线上接口**的工具——递归压缩本地文件夹里的视频，依赖外部 ffmpeg（见约束 2 与 [docs/架构.md](docs/架构.md) §1.4）。

## 文档地图（先查再动手）

| 文档 | 唯一负责的内容 |
|---|---|
| [README.md](README.md) | 仓库门面：功能一览、快速开始入口与文档导航；**只放指针，不复述细则**（不进发布包） |
| [docs/架构.md](docs/架构.md) | 总体架构、目录结构、**API 路由总表**、取消类与**视频压缩**链路要点；**后端共享层约定（§3）与设计令牌细则（§4）的唯一权威** |
| [docs/视频上传链路.md](docs/视频上传链路.md) | 视频上传链路全部细节（站点 / 凭证 / 签名 / 流式 / Job / 取消 / 幂等） |
| [docs/开放平台链路.md](docs/开放平台链路.md) | OAuth 流程、v2 签名、**token 刷新与失效语义的唯一权威** |
| [docs/监控大屏实现.md](docs/监控大屏实现.md) | 监控按需采集调度、六域采集口径、金额换算、告警引擎与存储 |
| [docs/监控大屏.md](docs/监控大屏.md) | 监控大屏的使用者说明（完整口径、指标表、告警怎么读） |
| [docs/开发指南.md](docs/开发指南.md) | 快速开始、新增工具步骤、**测试与调试（含测试假失败的坑）的唯一权威** |
| [docs/GitHub提交与发布指南.md](docs/GitHub提交与发布指南.md) | 提交代码、**提交前敏感信息与安全自检（§2.4）**、发布 Release 与 `update.json` 清单的流程与坑（发布方视角） |
| [新手入门指南.md](新手入门指南.md) | 最终用户操作，**必须自包含**（见约束 9） |
| [docs/shopee_api_doc/README.md](docs/shopee_api_doc/README.md) | Shopee 开放平台官方文档整站目录与抓取方式 |

## 关键约束（务必遵守）

1. **极简零配置**，双击 `启动.bat` 即用，不加环境变量/额外安装步骤。
2. **后端不新增运行时依赖**；前端新增依赖需同步更新 `frontend/package.json` 与 `docs/架构.md`。
   - 例外说明：视频压缩需要外部 `ffmpeg`（Node 无法重编码）。它是**外部可执行文件而非 npm 依赖**，`package.json` 不变；由页面「下载并安装 ffmpeg」落到仓库根 `bin/`（gitignored，**不进发布包、不随更新覆盖**），也可由用户自备并被 `KP_FFMPEG` / PATH 探测到。细节见 [docs/架构.md](docs/架构.md) §1.4。
3. **接口还原，不用 UI 自动化**：直接调 Shopee 内部 HTTP 接口，遵循抓包链路；不要改成 Playwright/Selenium。
4. **端口固定 8765**，扩展与文档已硬编码。
5. **凭证不入库**，日志不完整打印 Cookie/Authorization；**每次提交/推送前必须做敏感信息自检**（红线见「关键注意点」）。
6. **中文优先**，文档/注释/用户文案用中文，代码标识符可英文。
7. 改入口/端口/结构时，同步更新 `启动.bat`、`docs/架构.md`、`AGENTS.md`，及涉及的具体链路文档 / `docs/开发指南.md`。
8. 不主动新增文档文件，用现有 10 份（见文档地图；用户明确要求新增文档时除外）；Shopee 开放平台接口资料统一放 `docs/shopee_api_doc/`（刷新方式见其 README）。
9. **`新手入门指南.md` 必须自包含**：面向最终用户，**不得链接其它文档**，使用者要看的操作步骤、前提与常见问题都要写在这一个文件里。
10. **同一事实只写一处**：细则归上表列出的负责文档，其它文档只写红线与指针；**不要在本文件复述细则**（复述过的必然随实现漂移）。唯一例外是 `新手入门指南.md`（约束 9）——它内联的用户可见口径（如监控阈值、告警级别）变化时，需与负责文档手工同步两处。

## 技术栈速查（细则见 [docs/架构.md](docs/架构.md) §3–§4）

- 后端一律 **CommonJS**（`require`/`module.exports`）；前端 **Vue3 SFC**。改代码时保持文件原有风格，不混用。
- **后端不新增运行时依赖**（现仅 `exceljs` / `https-proxy-agent` / `socks-proxy-agent`）；前端现为 `vue` / `element-plus` / `vite` / `echarts`（监控大屏折线图，按需引入）。
- **共享层必须复用，不许各写一份**：会话/请求层 `lib/shopee-session.js`、JSON body `lib/http-utils.js`、端口 `lib/config.js`、长任务 `lib/jobs.js`、重试 `lib/retry.js`、导出落盘 `lib/export-utils.js`、统一出站 `lib/http.js`；前端对应 `bootstrap.js` / `composables/`（跨页共享）/ `components/` / `utils/`（纯函数）/ `styles/base.css`，页面专属 composable 与子组件放各自页面目录。**各函数语义与「为什么不能绕过」见 [docs/架构.md](docs/架构.md) §3–§4，改前先读那一节。**
- **样式一律取设计令牌，不写死颜色与尺寸**：浅色取 `styles/base.css` 的 `:root`，深色取 `monitor/monitor.css` 的 `--d-*`；两个硬约束（深色令牌必须挂 `html`、ECharts 文字色在 `monitor/trend-chart.js`）见 [docs/架构.md](docs/架构.md) §4。
- **CORS 是本机白名单**（`main.js` 的 `isAllowedOrigin`），**不要退回 `Access-Control-Allow-Origin: *`**。
- 改前端 `src` 后必须 `vite build` 重建 `frontend/dist`（gitignored 产物）；新增共享模块后逐个确认调用方已 `require`（`grep -n "require('./lib/xxx')" server/*.js`），遗忘表现为路由 500。
- **改后端 `server/` 后必须重启服务才生效**：先关掉旧的黑窗口再双击 `启动.bat`（端口被占用时双击只会开浏览器、不会重启，见「本机环境坑」）。**前端 `dist` 是每次请求从磁盘读的、后端模块只在进程启动时加载一次**，所以「改了没生效」往往是新前端配旧后端，别去怀疑代码。

## 关键注意点（红线一句话，细节见各自链路文档）

- **取消类链路（取消竞价 / Hot Listing）**：只处理资格正常的行；前端 SPU 配置区只渲染已选店铺，但 `spuMap` 必须**全量**回传（少传键＝删配置）。细节见 [docs/架构.md](docs/架构.md) §1.2。
- **视频上传**：**写操作必须 `call({ idempotent:false })`**，否则失败重放会「重复合并 / 发两条视频」；大文件必须流式，不得整文件 `readFileSync`。详见 [docs/视频上传链路.md](docs/视频上传链路.md) §8。
- **开放平台**：**刷新一律按店铺 `shop_id` 逐店进行（`ensureFresh` / `refreshShopNow`），绝不用 `merchant_id` 整组刷**——官方要求 shop_id / merchant_id「必须分别刷新」，实测 merchant_id 刷出来的是商户级 token，调店铺级接口报 `invalid_acceess_token`，会把「状态显示有效」的店铺刷成全部不可用；官方功能统一经 `callOpenApi`，不自行拼签名。详见 [docs/开放平台链路.md](docs/开放平台链路.md) §3。
- **重点店铺筛选**：开放平台页勾选「重点店铺」后，**监控大屏采集与 shopee_skill 只作用于重点店铺**（一个都没勾选时回落为全部已授权店铺，不是硬性开关）；判定源唯一在 `server/openapi/store` 的 `getImportantIds`，改大屏注册表或 CLI 取店范围必须复用它，否则两边范围会漂移。各工具页「选择店铺」下拉不受该筛选影响。详见 [docs/开放平台链路.md](docs/开放平台链路.md) §4。
- **监控大屏**：金额阈值一律按人民币配置与比较；规则阈值「留空 = 该级别不触发」必须用 `null` 传递（前端空值转 `null`，否则默认阈值会「复活」）；系统自检告警同样受规则 `enabled` 约束。详见 [docs/监控大屏实现.md](docs/监控大屏实现.md) §4。
- **开放平台接口报参数错误时**（error_param / 格式错 / Wrong sign / error_unknown）：网关报错文案经常是误导性的，**先查 `docs/shopee_api_doc/` 核对参数名与必填项，再用最小参数组合逐变体验证**，不要按字面改——完整排查顺序见 [docs/开发指南.md](docs/开发指南.md) §5.1。
- **版本与自更新**：`server/data/`（真实店铺授权）**绝不能进发布包，也绝不能被一键更新覆盖**；更新只按 `server/update.js` 的 `COPY_ITEMS` 白名单覆盖，落盘后必须重启才生效。流程与约束见 [docs/架构.md](docs/架构.md) §1.3。
- **发布打包（`npm run pack`）**：zip 必须**显式列出顶层条目**（传 `.` 会让资源管理器显示为空包）并带 **`--options hdrcharset=UTF-8`**（否则中文文件名按本机代码页 GBK 写入且不置标志位，在 Linux / macOS / 英文 Windows 解压全是乱码）。`pack.js` 已内置这两点并在打包后自检编码，**看到「⚠ 编码」警告不要发布**。详见 [docs/GitHub提交与发布指南.md](docs/GitHub提交与发布指南.md) §3.2、§3.6。
- **视频压缩**：产物默认与源文件同目录并加 `-compressed` 后缀（扫描时反向跳过产物与临时文件，否则连点两次会把产物再压一遍）；**目标码率必须与源码率取小**，否则「只超时长、体积远低于上限」的视频会被抬到远高于源码率的码率、越压越大（3MB/15s 曾压成 23MB）；只有显式 `overwrite:true` 才覆盖原文件，两种模式都先写临时文件、复核确实变小后 `rename` 就位（**不要先删同名文件再改名**）；ffmpeg 退出码 0 **不等于**体积达标，必须重新 stat 产物、超标则降码率重试；取消要 `kill` 子进程并删掉半成品。细节见 [docs/架构.md](docs/架构.md) §1.4。
- **提交 / 推送前必须做敏感信息与安全自检（红线）**：`git status` 逐条过目，确认没有把真实凭证（Cookie / token / AK-SK / 密码 / 代理账密）、`server/data/`、`*-session.json`、`settings.json`、`*.har`、`research/` 抓包脚本、真实店铺授权与个人信息带进仓库。三条硬要求：①**文件名干净不等于内容干净**——必须看 diff 内容（代码、示例、文档、测试 fixture、提交信息、Release 正文与附件里同样不得出现真实凭证，一律脱敏成占位符）；②规则缺失先补 `.gitignore` 再提交，不要靠「这次小心一点」；③**已推送的凭证视为已泄露**，必须立刻作废重签，只删文件、只改工作树都不解决问题。完整检查清单与关键词扫描命令见 [docs/GitHub提交与发布指南.md](docs/GitHub提交与发布指南.md) §2.4。

## 经验沉淀（踩坑即记）

开发过程中如果 agent 走了弯路（排查方向错误、被报错文案误导、踩到环境/接口的坑），解决后应把经验沉淀回本仓库文档，避免重复踩坑：

- **记什么**：只记可复用的结论——坑的触发条件、正确做法、背后的原因，不要记排查流水账。
- **记在哪**：按文档地图的「唯一负责的内容」投递——共享层/约定 → `docs/架构.md` §3–§4；测试 → `docs/开发指南.md`；某条链路 → 对应链路文档；本机执行环境 → 本文件「本机环境坑」。
- **怎么记**：每条一两句话，给出可执行的规则（如「X 场景必须用 Y，因为 Z」）；过时或已被修复的条目及时删除，保持文档精炼。

## 本机环境坑（agent 执行环境，跑命令前先看）

本机为 Windows，shell 行为与常规 Linux 环境不同；以下坑已反复踩过，直接按推荐做法执行：

- **bash 与 PowerShell 都可能不可靠**：bash 的 `ls` / `grep` / `tail` / `rm` 常报 `command not found`（exit 127）；PowerShell 常只返回 exit 0、stdout 为空，`>` / `Out-File` 重定向会产出 UTF-16/GBK 乱码文件（Read 报 binary）。**要看命令输出就让命令自己写文件**（node 脚本里 `fs.writeFileSync(..., 'utf8')`），再用 Read 工具读。
- **删文件别用 `rm`**：会被安全删除 shim 拦截（按累计删除数计，超 50 报 `SAFE_DELETE_BULK_CONFIRM_REQUIRED`，批量清目录必失败）。单文件用 `[System.IO.File]::Delete('<绝对路径>')`，清整个目录用 `[System.IO.Directory]::Delete('<绝对路径>', $true)`，测试内零散删除走 `test/helpers.js` 的 `removeFile()`。**清理一堆调试产物（`.tmp_*` 之类）走 node 脚本的 `fs.unlinkSync` / `fs.rmSync` 也不触发 shim**，比逐个调 PowerShell 省事。
- **批量校验语法别写 for 循环**：bash 循环体内命令不可用时 exit code 仍是 0，错误被静默吞掉。改用 `;` 串联逐条执行、末尾显式回显确认，例如 `node --check a.js; node --check b.js; echo OK`。**注意本机是 PowerShell 5，不支持 `&&` / `||`**（写了会直接 ParserError、整条命令一行都不执行），也别照搬其它环境文档里的 `&&` 写法。
- **同一文件的多处修改必须串行**：在同一条消息里对**同一个文件**发多个编辑请求会互相覆盖（读-改-写竞态），最终只有最后一个落盘，而每次都返回成功——曾因此静默丢掉 `pack.js` 顶部注释与 `docs/架构.md` 的一处改动。改完**回读确认**，同一文件分多次调用，只有跨文件的编辑才可并行。
- **前端没有自动化测试**：`vite build` 只保证编译期正确，拦不住 prop 名写错 / 模板变量未定义这类运行时错误，改完前端要跑页面级验证（cdp-page-verify 技能）；本机 8765 常被用户已启动的服务占用，先探端口，别杀用户的服务。
- **冒烟 `/monitor/` 前必须屏蔽 `POST /api/monitor/presence`**（CDP `Network.setBlockedURLs`）：该接口触发按需巡检，不屏蔽等于替用户对全部已授权店铺发起一轮真实采集；其余监控接口是只读的，照常请求即可。
- **验证「未安装 ffmpeg」的首屏引导要换新进程**：`compress/ffmpeg.js` 把探测结果缓存在进程内，已在跑的实例会一直返回「已就绪」；把 `bin/*.exe` 临时改名后**必须重启服务（或换端口起新实例）**才看得到 warning 分支，验完记得改回来。
- **改后端后必须重启服务，否则「改了没生效」（踩过最大的一次坑）**：`启动.bat` 先 `netstat` 探 8765，占用则只开浏览器然后退出（设计使然，方便二次双击），所以**双击不会重启已在跑的服务**——必须先关掉旧的黑窗口再双击，否则会误判「改了没生效」。**「新前端 + 旧后端」的典型症状**：页面 UI 是新的（`dist` 每次请求从磁盘读），行为却是旧的（后端模块只在进程启动时加载一次）——曾出现「压缩页明明有新的『直接覆盖原文件』选项，点了没用、还继续越压越大」，排查半天才发现 8765 上跑的还是几小时前启动的旧进程。**怀疑没生效时先对版本**：`GET /api/<模块>/status` 看响应里有没有已被删掉的旧字段，再用 `Get-Process -Id <pid> | Select StartTime` 看进程启动时间是否早于本次改动。想验证新代码而不动用户服务：`PORT=8899 node server/main.js` 另起一个实例，别去杀用户的进程。
- **新增工具页后不重启的典型症状 = 该页 404、其它工具全正常**：`/xxx/` → `/xxx/index.html` 的映射表在 `lib/http-utils.js` 的 `DIR_INDEX`，旧进程内存里没有新条目，而静态文件本身已能从磁盘读到（所以直接访问 `/xxx/index.html` 反而 200，很容易误判成「文件没构建」）。看到这个组合先怀疑后端没重启，不要去查 dist。顺带：`/xxx`（无尾斜杠）对所有工具页一律 404，这是既有行为，不是 bug。
- **BtbN / gyan.dev 的 ffmpeg 直连很慢或超时**（实测 gyan.dev 约 0.12MB/s、GitHub 直连挂断），走 `https://gh-proxy.com/` 前缀的加速代理可达 45MB/s——`compress/constants.js` 的 `FFMPEG_SOURCES` 已按此排序，别把直连地址提到前面。

## 测试

`node test/test.js`（或 `npm test`）：单元（`test/unit.test.js` 编排 `test/unit/` 按主题拆分）+ 开放平台刷新链路（`test/openapi-refresh.test.js`，离线 mock 网关）+ 接口冒烟（`test/api.test.js`，临时端口 8865），**不访问真实站点**；session 凭证文件测试前备份、结束后原样恢复。

压缩相关的单元用例（`test/unit/compress.test.js`）只测纯函数与扫描过滤，**不 spawn ffmpeg**（本机没装也能跑）；接口冒烟只验「参数校验 / 控制路由 / 扫描」这些不需要 ffmpeg 的分支。

**测试假失败的三个坑（数据目录隔离 / 金额断言先钉汇率 / mock 网关类测试清 `require.cache`）最容易误改代码**，动手前先读 [docs/开发指南.md](docs/开发指南.md) §4 的对应说明；运行方式与新增用例同样见该节。定位后端 500 用 `KP_TEST_SERVER_LOG=1 node test/test.js`。
