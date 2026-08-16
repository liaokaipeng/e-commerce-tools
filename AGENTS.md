# AGENTS.md

本文件为 AI 代理（及人类协作者）提供仓库工作上下文。请先通读再动手。

## 仓库概览

本仓库为**工具合集（shopee-tools-all-in-one）**：单服务、单端口（8765）、单网页，提供四个工具（TikTok 无水印下载 / Shopee 竞价导出 / Shopee 取消竞价 / Shopee 视频批量上传）的本地 Node HTTP 服务 + 一个前端门户页，按 Tab 切换使用。其中视频上传在门户页按站点拆为「跨境视频上传」「本土视频上传」两个 Tab（共用 `/video/` 页面，经 `?mode=cn|ph` 固定站点）；另设「开放平台」Tab（`/openapi/`）：录入 App 完成店铺 OAuth 授权并管理 Token，为后续官方 Open API 功能统一提供登录与调用入口；以及「监控大屏」Tab（`/monitor/`）：对已授权店铺定时巡检采集（订单/商品/健康/广告/资金/售后评价六域），P0/P1/P2 三级告警大屏展示（告警仅在大屏，不接 IM）。

> 架构与目录结构见 [docs/架构.md](docs/架构.md)；开发流程、后端约定与测试见 [docs/开发指南.md](docs/开发指南.md)；仓库概览与快速开始见 [docs/README.md](docs/README.md)；监控大屏的使用、指标口径与后续待办见 [docs/监控大屏.md](docs/监控大屏.md)；最终用户操作见 [新手入门指南.md](新手入门指南.md)；Shopee 开放平台接口资料（开发者指南 / API 参考整站目录，中文版）见 [shopee_api_doc/README.md](shopee_api_doc/README.md)。

## 关键约束（务必遵守）

1. **极简零配置**，双击 `启动.bat` 即用，不加环境变量/额外安装步骤。
2. **后端不新增运行时依赖**；前端新增依赖需同步更新 `frontend/package.json`、本文件技术栈速查与 `docs/README.md`（当前前端含 echarts，用于监控大屏折线图）。
3. **接口还原，不用 UI 自动化**：直接调 Shopee 内部 HTTP 接口，遵循抓包链路；不要改成 Playwright/Selenium。
4. **端口固定 8765**，扩展与文档已硬编码。
5. **凭证不入库**，日志不完整打印 Cookie/Authorization。
6. **中文优先**，文档/注释/用户文案用中文，代码标识符可英文。
7. 改入口/端口/结构时，同步更新 `启动.bat`、`docs/README.md`、`docs/架构.md`、`AGENTS.md`（涉及视频上传链路/测试结构时还应更新 `docs/开发指南.md`）。
8. 不主动新增文档文件，用现有 `docs/README.md` / `docs/架构.md` / `docs/开发指南.md` / `docs/监控大屏.md` / `新手入门指南.md` / `AGENTS.md`（用户明确要求新增文档时除外）；Shopee 开放平台接口资料统一放 `shopee_api_doc/`（官方文档整站目录中文整理版，刷新方式见其 README）。

## 技术栈速查

- 后端一律 **CommonJS**（`require`/`module.exports`）；前端用 **Vue3 SFC**。改代码时保持文件原有风格，不混用。
- 后端依赖仅 `exceljs` / `https-proxy-agent` / `socks-proxy-agent`；前端依赖 `vue` / `element-plus` / `vite` / `echarts`（监控大屏折线图，按需引入，仅 monitor 入口加载）。
- 前端共享代码优先复用：`frontend/src/composables/useToolPage.js`（默认目录 / 日志滚动 / SSE 流读取，tiktok/bidding/video 等页共用）、`frontend/src/composables/useShopeeSession.js`（Shopee 登录状态轮询 + 店铺分组勾选，bidding/bidding-cancel 共用）、`frontend/src/components/` 下 LogPanel（控制台日志）/ DirRow（目录行）/ LoginCard（登录卡）/ StorePicker（店铺选择）；公共页面样式在 `frontend/src/styles/base.css`。
- `tiktok.js` / `video.js` / `openapi.js` / `monitor.js` 只做路由注册，链路拆到 `server/tiktok/` / `server/video/` / `server/openapi/` / `server/monitor/` 子模块；新增逻辑放对应子模块，不要塞回入口文件。

## 关键注意点（详见 docs/架构.md）

- 取消竞价：人工流程「竞价详情 → 进行中的竞价 → 待改进 → 逐个撤销」对应接口 `get_item_ongoing_list`（`filter.page_tab=2` 即待改进，`page_tab=1` 为进行中全部）+ `seller_withdraw`（body `{ bid_id }`）；与竞价导出共用 `bidding-session.json` 与 `stores.json`。
- 视频上传按站点拆分：cn 跨境分片+merge / ph 菲律宾单次 PUT+task；**solutions 接口成功码为 200000（非 0），有 post_id 即发布成功**。
- 跨境凭证经 `resolveCnAuth` 统一解析（账号级通用，取有效期最长者）；菲律宾需 User ID。
- 视频纯函数（md5/etag/AES/SigV4/MP4 探测/行校验）统一在 `server/lib/video-utils.js`，行校验阈值 `CAPTION_MAX_LENGTH` 与前端 `video/App.vue` 即时预览校验保持一致；新增此类纯函数放 server/lib 并补单测，不要塞回 video.js。
- 大文件**流式处理**（`streamHashes` / `readChunk` / 读流 PUT / `probeVideoFile` 探针），不得整文件 `readFileSync` 进内存。
- 任务可取消（`POST /api/cancel` + `AbortController`），取消造成的中断在 `call` 里不重试。
- SSE 事件按 job 缓存（`jobEvents`），迟到连接自动回放，否则前端可能一直卡在「上传中」。
- 扩展（MV3）抓凭证推 `/api/creds`，缓存在 `chrome.storage.local`，抓到新请求时整包重推（故 `video-session.json` 清空后会被自动写回）。
- 开放平台登录：
  - **签名与网关**：`base = partner_id + api_path + timestamp（+ access_token + shop_id）`、`sign = HMAC-SHA256(partner_key, base)` 小写 hex（纯函数在 `server/lib/openapi-utils.js`，规则以官方 developer-guide/20 为准）；后台 redirect 只做域名校验、不接受指向本机的地址（IP/localhost/sslip.io 均被拒）且不能带查询参数，`validateRedirect` 支持 auto（本机域名白名单）与 manual（任意 http/https 域名 + 前端粘贴回调链接或域名转发页）两种模式，默认占位 `https://example.com/`；`auth_partner` 为本地拼接的 GET 授权链接（**不调接口**，POST 会 404）；**查询类接口（get_*/search_*）用 GET（全参数放 query）、写操作/换 token 用 POST（公共参数 query、业务参数 body），方法用错网关 404**；主账号授权回调只有 code+main_account_id（无 shop_id），token/get 返回 shop_id_list 全部保存。
  - **刷新接口特殊（生产实测）**：`access_token/get` 的签名 base 只拼 partner_id+api_path+timestamp，query 只放公共三参数，body 为 `{ partner_id: 数字, shop_id: 数字, refresh_token }`（数字类型，字符串报格式错）；刷新后旧 refresh_token 立即失效，必须先拿到新 token 再写盘；刷新结果绑定发起刷新的店铺（不跨店传播），多店铺刷新经全局串行链执行。
  - **失效与续期**：`callOpenApi` 确认凭证死透（`isAuthDead`）后经 `markShopInvalid` 标记店铺「需重新授权」（不再发请求，大屏暂停采集），重新授权或调用成功自动清除；共享 refresh_token 的店铺组到期经 `planRefresh` 决策走 merchant_id 整组刷新（`refreshTokenWithMerchant` + `saveRefreshResultGroup` 全组传播，官方 FAQ138 Q8 语义），失败则整组标记需重新授权；网关对失效凭证的误导性文案（Invalid access_token / refresh token or shop_id is wrong）已在 `hintOf` 翻译为重新授权提示。
  - **凭证安全**：存 `server/data/openapi-session.json`（按环境分区，测试经 `OPENAPI_SESSION_FILE` 环境变量隔离），对外一律 `maskToken` 打码。
- 后续官方 Open API 功能统一经 `server/openapi/client.js` 的 `callOpenApi(apiPath, 业务参数, { shopId })` 调用：自动签名、附带 token、过期自动刷新（per-shop 锁 + 全局串行链防并发），不要自行拼签名或管理 token。查询类接口（get_*/search_*）需传 `{ method: 'GET' }`，写操作默认 POST。
- 监控大屏：
  - **按需采集与店铺开关**：仅大屏页面打开时才巡检（前端每 30s 心跳 `POST /api/monitor/presence`，服务端 75s 租约兜底；门户切 Tab 经 `postMessage('portal-tab')` 告知启停，`setPresence` 激活时立即补一轮），离开页面即停采；`/api/monitor/shops-config` 读写 `config.json` 的 `excludedShopIds` 排除名单（已授权店铺默认全部监控），未启用监控的店铺不进巡检、不出现在总览/告警列表（总览含 `excludedCount`），其未关闭告警经 `engine.closeShopAlerts` 自动关闭，保存后 `notifyConfigChanged` 即时生效并广播 `config` SSE 事件。
  - **采集要点**（域与频率：订单 10 分钟 / 商品 30 分钟 / 健康·广告·资金·售后 60 分钟；口径与实测接口形态见 `docs/架构.md` 第 8 节）：`order/get_order_list` 必填 order_status+time_range_field+time_from/to+page_size（≤15 天，order_sn 前缀 YYMMDD 按天估算订单年龄）；`product/get_item_list` 必填 item_status（缺了报 product.error_unknown）且库存需逐商品 `get_model_list` 按商品粒度合计（每轮抽查 50 个）；健康指标读 `get_shop_performance` 的 `response.metric_list`，问题商品数读 `get_listings_with_issues`（明细按 reason 聚合进告警消息）、处罚记录读 `get_punishment_history`（必填 punishment_status：1=进行中/2=已结束）。新域按官方文档接入（未经生产实测）：广告 `performance_date` 为 DD-MM-YYYY 单日、`get_comment` 用 cursor 游标（item_id 可选，全店扫描失败降级逐商品）、wallet/returns 的 `page_no` 为 offset 0 起、payout 仅跨境、wallet 仅本土、escrow/payout 无状态字段（冻结/延迟以流水 PENDING/FAILED 近似）；全部子调用因权限不足失败时该域标记 unsupported 跳过（不触发系统自检告警，店铺卡该域显示「—」）。
  - **金额口径**：金额类指标（单位「元」）**阈值一律按人民币配置与比较**（`engine` 评估前经 `monitor/currency.js` 的 `toRmb` 换算，快照/告警 current 存当地货币原始值）；大屏金额展示全局切换「当地货币（默认）/人民币」（`config.json` 的 `currencyMode`，`GET/POST /api/monitor/currency-config`，切换后广播 `config` SSE，矩阵/趋势/告警消息由路由层按模式换算渲染）；店铺币种按 `get_shop_info` 的 region 自动识别（首次采集写入 meta.currency，未知按人民币）；汇率每日自动拉取免费 keyless 接口（open.er-api.com）缓存 `rates.json`（24h），失败/离线回退内置静态汇率表，仅在有已授权店铺时触发在线刷新（测试环境离线）。
  - **告警与授权失效**：告警引擎纯函数在 `server/monitor/rules.js`、生命周期在 `engine.js`，系统自检定级 1→P2、2→P1、≥5→P0；凭证失效（isAuthDead）的店铺被标记「需重新授权」后调度器跳过其采集并关闭其采集失败告警，大屏横幅显示待重新授权数量（reAuthCount）并可一键跳「开放平台」Tab，重新授权后立即恢复（授权回调经 `notifyAuthChanged` 即时通知调度器刷新店铺列表，店铺列表每次巡检都重读，无需等周期）；数据在 `server/data/monitor/`（gitignored，测试经 `MONITOR_DATA_DIR` 隔离）。使用者视角与后续待办见 `docs/监控大屏.md`。
- 开放平台接口报参数错误时（error_param / 格式错 / Wrong sign / error_unknown）：**先查 `shopee_api_doc/` 目录与官方接口页面核对参数名与必填项**，再用最小参数组合逐变体验证；网关报错文案经常是误导性的（会随参数位置/类型/签名基串逐层漂移），不要按字面改——完整排查顺序见 `docs/开发指南.md` 4.1 节，实测结论在 `docs/架构.md` 6.2/6.3/8 节。

## 测试

`node test.js`（或 `npm test`）：单元（`test/unit.test.js`，纯函数 + 任务取消，不启动服务）+ 接口冒烟（`test/api.test.js`，临时端口 8865，含 SSE 迟到回放、任务取消与 404 兜底），**不访问真实站点**；session 凭证文件测试前备份、结束后原样恢复。运行方式与新增用例见 [docs/开发指南.md](docs/开发指南.md)。
