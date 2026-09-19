# Shopee 数据查询 Skill（独立 CLI）实施计划

## 1. 摘要

在仓库根目录新建 `shopee_skill/`，提供一个**可独立运行的 CLI**（`node shopee_skill/cli.js`），让用户/agent 查询 Shopee 开放平台数据。核心原则：

- **复用仓库既有底座，不重写签名与刷新**：CLI 直接 `require('../server/openapi/client')` 的 `callOpenApi`，复用 `server/openapi/store` 的凭证（`server/data/openapi-session.json`）。**不启动 8765 服务**、不复制一套签名逻辑、不自行实现 OAuth。
- **覆盖 shopee_api_doc 全部查询接口**：以内置接口目录（离线解析 `docs/shopee_api_doc/_raw/doc_module_v2.json`）驱动 `list / search / describe / call`，任一官方查询接口都可调。
- **默认只读**：非查询类接口（`update_* / add_* / delete_*` 等）默认拒绝，需显式 `--allow-write`。
- **两处落盘**：实体在 `shopee_skill/`；另在 `.trae/skills/shopee-query/SKILL.md` 注册一份供 agent 自动发现。

预期产出：6 个新文件（5 个 JS + 1 个 SKILL.md）在 `shopee_skill/`，1 个注册用 SKILL.md 在 `.trae/skills/shopee-query/`。**不修改任何现有文件。**

## 2. 现状分析（已探明的仓库事实）

| 事实 | 位置 | 对本次实现的意义 |
|---|---|---|
| 统一调用入口 `callOpenApi(apiPath, business, { shopId, method })` | [client/index.js](file:///c:/Users/84463/Desktop/code_space/kp_tools/server/openapi/client/index.js)、[call.js](file:///c:/Users/84463/Desktop/code_space/kp_tools/server/openapi/client/call.js) | CLI 的唯一取数通道；自动签名 / 带 token / 过期自动刷新 / 认证失败强制刷新一次重试 |
| 查询类接口用 `GET`（公共参数 + 业务参数全放 query），写操作 / 换 token 用 `POST`（业务参数放 body） | [transport.js](file:///c:/Users/84463/Desktop/code_space/kp_tools/server/openapi/client/transport.js)、[开放平台链路.md](file:///c:/Users/84463/Desktop/code_space/kp_tools/docs/开放平台链路.md) §2 | CLI 必须把 `method` 正确透传，否则网关 404 |
| 凭证持久化 `server/data/openapi-session.json`（gitignored），含 `app{partnerId,partnerKey,env}` 与 `shops[env][shopId]` | [store.js](file:///c:/Users/84463/Desktop/code_space/kp_tools/server/openapi/store.js) | CLI 的 `shops` 命令与取数共用同一份凭证，无需再授权 |
| `store.status()` 返回当前环境店铺的 `shopId / state / accessExpireAt / remainSec`（**不打网关**，纯读内存+文件） | [store.js](file:///c:/Users/84463/Desktop/code_space/kp_tools/server/openapi/store.js#L119-L149) | `shops` 命令默认走它，保证离线秒回 |
| `authorizedStores()` 返回 `{id,name,region}`，但会对缺失店铺名的店调 `get_shop_info`（**打网关**） | [stores-view.js](file:///c:/Users/84463/Desktop/code_space/kp_tools/server/openapi/stores-view.js) | 仅 `shops --names` 时启用，避免默认命令产生网络副作用 |
| 响应载荷分层口径：`顶层 / response / data` | [parse.js](file:///c:/Users/84463/Desktop/code_space/kp_tools/server/openapi/client/parse.js) | 输出解包遵循同一口径 |
| 错误分类与中文提示 `hintOf / isAuthDead / isAuthRetryable` | [errors.js](file:///c:/Users/84463/Desktop/code_space/kp_tools/server/openapi/client/errors.js) | CLI 错误输出复用，给出可执行的「重新授权」等提示 |
| 接口目录原始数据：`modules[].items[] = { id, name, type, priority, status }`，`type===1` 为接口（如 `v2.product.get_item_list`），`type===2` 为指南 | [doc_module_v2.json](file:///c:/Users/84463/Desktop/code_space/kp_tools/docs/shopee_api_doc/_raw/doc_module_v2.json) | 离线生成接口目录；`apiName` 可推导 `apiPath` |
| 模块中文名表在 `api/README.md` 的「模块总览」表格中（模块名 / 中文名 / 模块 ID / 条目数） | [api/README.md](file:///c:/Users/84463/Desktop/code_space/kp_tools/docs/shopee_api_doc/api/README.md#L12-L45) | 顺带解析该表得到模块中文名，避免在代码里再手抄一份映射 |
| 翻页有三种语义：`cursor`（订单/评价）、`page_no`（资金/售后，起始 1 或 0）、`offset`（商品列表） | [paging.js](file:///c:/Users/84463/Desktop/code_space/kp_tools/server/monitor/collectors/paging.js)、[constants.js](file:///c:/Users/84463/Desktop/code_space/kp_tools/server/monitor/collectors/constants.js) | `--all` 自动翻页的自适应依据 |
| 仓库无 `.trae/` 目录、无任何既有 SKILL.md | LS 结果 | 全新创建，无覆盖风险 |
| `.gitignore` 未忽略 `.trae/` | [.gitignore](file:///c:/Users/84463/Desktop/code_space/kp_tools/.gitignore) | `.trae/skills/` 注册文件会被正常纳入版本管理 |

## 3. 目录与文件结构

```
shopee_skill/                     ← 实体（唯一权威实现）
├── SKILL.md                      ← 完整 skill 说明（frontmatter + 用法，中文）
├── cli.js                        ← CLI 入口（命令分发 + 参数校验 + 输出）
└── lib/
    ├── args.js                   ← 轻量参数解析（--k v / --k=v / --flag / 可重复项）
    ├── catalog.js                ← 接口目录（离线解析 _raw + 模块中文名；apiName↔apiPath；读写推断）
    ├── paging.js                 ← --all 自动翻页（cursor / page_no / offset 三态自适应）
    └── output.js                 ← 输出与错误（美化 JSON / --raw / 载荷解包）

.trae/skills/shopee-query/
└── SKILL.md                      ← 注册入口：frontmatter（用于自动发现）+ 简版命令速查 + 指向 shopee_skill/SKILL.md
```

依赖方向：`cli.js → lib/*`（纯本地）与 `cli.js → ../server/openapi/client`（复用仓库底座）。`lib/*` 不反向依赖 `cli.js`。

## 4. 详细设计

### 4.1 CLI 命令一览

| 命令 | 作用 | 是否打网关 |
|---|---|---|
| `shops [--names]` | 列出已授权店铺（默认离线读 `store.status()`：shopId / env / state / 到期时间 / 剩余秒数）；`--names` 时经 `authorizedStores()` 补店铺名与地区 | 默认否 |
| `list [--module <id\|名称>] [--keyword <kw>] [--writes]` | 列出接口目录，默认只列**查询类**（只读）；`--writes` 追加写操作接口；`--module` 按模块过滤；`--keyword` 按接口名子串过滤 | 否 |
| `search <keyword>` | 等价 `list --keyword <kw>`（含只读标记） | 否 |
| `describe <api>` | 显示单个接口元数据：`apiName / apiPath / method / read / 模块(中文) / 官方文档链接` | 否 |
| `call <api> [选项]` | 调用接口并输出数据 | 是 |
| `help` / `--help` | 中文用法说明 | 否 |

`<api>` 三种写法均接受，统一归一化：
- 官方接口名：`v2.product.get_item_list`
- 完整路径：`/api/v2/product/get_item_list`
- 简写：`product.get_item_list`

归一化规则（`catalog.normalizeApi`）：
- 以 `/api/` 开头 → 直接作为 apiPath；去前缀并替换 `/` 为 `.` 得到 apiName（若形如 `v2.x.y`）。
- 以 `v2.` 开头 → `apiPath = '/api/' + name.split('.').join('/')`。
- 其余（`product.get_item_list`）→ 前缀补 `v2.` 后同上。

### 4.2 `call` 选项

| 选项 | 说明 |
|---|---|
| `--shop <id>` | 目标店铺；省略时若仅一个已授权店铺则自动选用，多个则报错并列出候选，零个则提示先去「开放平台」页授权 |
| `--shop all` | 对当前环境全部已授权店铺逐个调用，输出以 shopId 为键的对象 |
| `--params '<json>'` | 业务参数 JSON（如 `--params '{"item_id":123}'`） |
| `--param k=v` | 可重复的单参数；值先尝试按 JSON 解析（数字/布尔），失败按字符串 |
| `--params-file <path>` | 从文件读取业务参数 JSON |
| `--method GET\|POST` | 显式指定方法（默认按下文规则推断） |
| `--all` | 自动翻页拉全量（见 4.3） |
| `--max-pages <n>` | `--all` 时的翻页上限，默认 `10`（与仓库 `MAX_PAGES` 对齐） |
| `--allow-write` | 放行写操作接口（默认拦截） |
| `--raw` | 输出网关原始响应（含 `error / message / request_id`） |

参数优先级：`--params` / `--params-file` 为基底，`--param k=v` 逐项覆盖。

### 4.3 方法推断与「默认只读」红线

- `--method` 显式指定时以它为准。
- 否则按接口名最后一段推断：匹配 `^(get|search|query|list|fetch|view|check|download)` → `GET`（只读）；其余 → `POST`（写操作）。
- **判定为 `POST` 且未带 `--allow-write` → 直接拒绝，不打网关**，错误信息给出接口名、推断方法与放行方式。
- 未在目录中的自定义 apiPath 同样适用上述推断；若推断为写操作同样需要 `--allow-write`。
- `list` / `search` 的输出对每条接口给出 `read: true|false`，让用户先看清再调。

这样既满足「支持所有查询接口」，又避免 agent 误调 `add_discount` / `delete_video` 之类改数据的接口（对齐 AGENTS.md「接口还原」红线）。

### 4.4 `lib/catalog.js`

- `loadCatalog()`：惰性加载 + 进程内缓存，返回 `{ modules, apis }`。
  - 读 `docs/shopee_api_doc/_raw/doc_module_v2.json`；对每个 `module.items[]` 取 `type === 1` 且 `name` 以 `v2.` 开头者，产出
    `{ apiName, apiPath, method, read, moduleId, moduleName, moduleZh, itemId, docUrl }`。
  - 模块中文名：从 `docs/shopee_api_doc/api/README.md` 的「模块总览」表格用正则解析 `模块ID → 中文名`；解析失败则回退英文 `module_name`（**不硬编码映射表**，保持与文档同源）。
  - 文件缺失 / 解析失败 → 抛中文错误并提示可运行 `node docs/shopee_api_doc/_tools/fetch-docs.js` 重新生成。
- `normalizeApi(input)` → `{ apiName, apiPath }`（规则见 4.1）。
- `findApi(input)` → 目录条目或 `null`。
- `inferMethod(apiName)` → `'GET' | 'POST'`（规则见 4.3）。
- `docUrlOf(apiName, moduleId)` → `https://open.shopee.cn/documents/v2/<apiName>?module=<moduleId>&type=1`。

### 4.5 `lib/paging.js`（`--all` 自动翻页）

`callWithPaging({ apiPath, business, shopId, method, all, maxPages })`：

- `all !== true`：直接 `callOpenApi(...)` 一次，原样返回。
- `all === true`：循环调用，首屏后按响应键自适应策略：
  - 响应含 `next_cursor` → **cursor 语义**：循环传 `cursor = next_cursor`，`more` 为假或 cursor 为空即停。
  - 响应含 `next_offset` → **offset 语义**：循环传 `offset = next_offset`，`more` 为假即停。
  - 响应含 `more` 且无上述两者 → **page_no 语义**：`page_no` 自 `business.page_no ?? 1` 起递增，`more` 为假或本页条数 < `page_size` 即停。
  - 无 `more` 字段 → 该接口不支持翻页，直接返回首屏。
  - 列表键：取 `response` 中第一个数组值字段（保持对象插入顺序），跨页拼接。
  - 每页请求均经 `callOpenApi`（自动签名 / 刷新）。
- 返回合并结果：在首屏响应上覆盖为 `{ ...首屏, [listKey]: 拼接数组, pages: 实际页数 }`。
- 循环受 `maxPages`（默认 10）硬上限约束，避免大店铺无限翻页。

### 4.6 `lib/output.js`

- `extractPayload(raw)`：按 `response → data → 顶层` 顺序解包（仅当 `response`/`data` 存在且非空时取用），与 [parse.js](file:///c:/Users/84463/Desktop/code_space/kp_tools/server/openapi/client/parse.js) 的口径一致。
- 默认 `call` 输出：
  - 单店铺 → `extractPayload(raw)` 的美化 JSON（2 空格缩进）。
  - `--shop all` → `{ "<shopId>": <载荷>, ... }`；单个店铺失败时该项为 `{ "__error": "<message>" }`，不中断其它店铺。
- `--raw` 输出：网关原始解析对象（`--shop all` 时为 `{ "<shopId>": <raw> }`）。
- 错误输出：写 stderr，形如 `{ "ok": false, "error": "<原始信息>", "hint": "<hintOf(...) 的中文提示>" }`，`process.exitCode = 1`。
- 全部命令输出均为合法 JSON（可被 `| jq`、管道与 agent 直接解析），列表类命令也输出 JSON 数组而非表格。

### 4.7 `lib/args.js`

极简解析器（零依赖）：
- 位置参数收集到 `_`。
- `--k=v` / `--k v` → `flags.k = v`；`--flag`（后无值或后接 `--`）→ `flags.flag = true`。
- `--param` 允许重复，收集为数组 `flags.param = [...]`。
- `-h` 等同 `--help`。

### 4.8 `cli.js`

- 首行 `#!/usr/bin/env node`（Windows 下无副作用）；`'use strict'`，CommonJS。
- 顶层 `try/catch`：统一走 `output.fail`（按 `isAuthDead` / `hintOf` 补中文提示），保证任何异常都以 JSON + 非零退出码收尾，不打印堆栈到 stdout。
- `require('../server/openapi/client')` 取 `callOpenApi / pickPayload / isAuthDead`；`require('../server/openapi/store')` 取凭证状态。
- 命令分发：`shops / list / search / describe / call / help`；未知命令给中文用法提示。
- **不暴露 token 刷新命令**：刷新由 `callOpenApi` 内部自动处理，CLI 不提供任何「逐店刷新」入口（对齐 AGENTS.md 开放平台红线）。
- 日志不打印 token / partner_key 全值。

### 4.9 `shopee_skill/SKILL.md`（权威版）

frontmatter：
```yaml
---
name: "shopee-query"
description: "查询 Shopee 开放平台数据（订单/商品/库存/广告/资金/售后等 450+ 接口）。当用户要查店铺的 Shopee 数据、或提到 shopee 订单/商品/库存/评价时调用。底层复用仓库 openapi client 与已授权店铺凭证。Invoke when user asks to query Shopee shop data."
---
```
正文（中文，含）：
- 何时调用 / 前置条件（需先在仓库「开放平台」页配置 App 并完成店铺授权；凭证存 `server/data/openapi-session.json`，gitignored，**切勿外泄**）。
- 命令速查 + 5~8 个真实示例（店铺列表、订单列表、商品列表、商品库存 `get_model_list`、店铺信息、差评、广告）。
- 「先 `list` / `search` 找接口 → 再 `describe` 看参数提示 → `call`」的标准流程；参数细节查官方文档链接。
- 排错：认证类错误 → 去「开放平台」页重新授权；参数报错 → 先查 `docs/shopee_api_doc/` 核对参数名再最小化验证（对齐 [开发指南](file:///c:/Users/84463/Desktop/code_space/kp_tools/docs/开发指南.md) §5.1）。
- 红线：默认只读，写操作需 `--allow-write`；不要在命令里粘贴凭证；不要用本 skill 做逐店刷新。
- 目录数据源与刷新方式说明。
- **不得包含任何真实凭证、店铺 ID、token（占位符示例）**。

### 4.10 `.trae/skills/shopee-query/SKILL.md`（注册版）

- 同样的 frontmatter（`name: "shopee-query"` + 同一条 description），保证 agent 自动发现与触发。
- 正文为**简版**：一段「本 skill 的完整说明见仓库根目录 `shopee_skill/SKILL.md`，执行前先读取」，加 4~6 行命令速查。
- 不做整篇复制，避免与 `shopee_skill/SKILL.md` 两处内容漂移（对齐 AGENTS.md 约束 10「同一事实只写一处」）。

## 5. 关键决策与假设

1. **复用而非复制**（用户选定）：CLI 依赖 `server/openapi/client`，凭证沿用 `server/data/openapi-session.json`。因此本 skill **必须与 kp_tools 仓库同仓库存在**，不能单独拷走到别的项目（用户已明确接受「复用仓库 openapi client」而非「完全自包含」）。
2. **覆盖范围 = 目录内全部接口**，不做监控六域的专用快捷命令（用户未选该分支）；六域数据同样可用 `call` + 官方接口名查询。
3. **默认只读**（用户选定）：写操作需 `--allow-write`。
4. **默认输出「response 载荷」美化 JSON，`--raw` 输出完整响应**（用户选定）。
5. **翻页默认首页，`--all` 自动翻页**（用户选定），三种翻页语义自适应。
6. **目录中文模块名解析自 `api/README.md`**，不新增手写映射表；解析失败回退英文名。
7. **`--shop all`** 为便利能力（本仓库多店场景常见），实现成本极低；如不需要可去掉该分支。
8. **不修改任何现有文件**（不含 AGENTS.md / docs）。skill 的可发现性由 `.trae/skills/` 注册承担，无需改动文档地图。
9. **SKILL.md 用中文**：skill-creator 默认建议英文，但本仓库 AGENTS.md 约束 6「中文优先（文档/用户文案）」优先，故正文中文、description 中英混排以兼顾触发召回。

## 6. 不改动 / 红线

- 不新增 npm 运行时依赖（仅 Node 内置模块 + 现有 `server/` 模块）。
- 不新增/修改 HTTP 路由、不动 8765 端口、不动前端。
- 不在 skill 的任何文件（含 SKILL.md、示例、错误信息）中出现真实 Cookie / token / partner_key / 真实店铺 ID。
- 不提供写操作默认路径、不提供逐店 token 刷新入口。

## 7. 验证步骤

1. **语法批量校验**（按 AGENTS.md 推荐写法，不用 for 循环）：
   `node --check shopee_skill/cli.js && node --check shopee_skill/lib/args.js && node --check shopee_skill/lib/catalog.js && node --check shopee_skill/lib/paging.js && node --check shopee_skill/lib/output.js && echo OK`
2. **目录解析正确**：`node shopee_skill/cli.js list --keyword get_order` → 应能命中 `v2.order.get_order_list` 等；`node shopee_skill/cli.js list` 条目数量级应与 `api/README.md` 记载的 454 接近（`type===1` 过滤后）。
3. **`describe`**：`node shopee_skill/cli.js describe v2.product.get_item_list` → 输出含正确 `apiPath=/api/v2/product/get_item_list`、`method=GET`、`read=true`、模块中文名与官方文档链接。
4. **`shops` 离线**：`node shopee_skill/cli.js shops` → 未配置 App / 未授权时给中文提示且**不发起网络请求**（用 `node --trace-*` 或断网观察，确保无出站）。
5. **只读红线**（不打网关即应拦截）：
   - `node shopee_skill/cli.js call v2.discount.add_discount` → 报「需 --allow-write」。
   - `node shopee_skill/cli.js describe v2.discount.add_discount` → `read=false`。
6. **缺参友好提示**：`node shopee_skill/cli.js call v2.product.get_item_list` → 无 `--shop` 且无已授权店铺时给中文提示，而非堆栈。
7. **不做真实网关调用的验证**：本机未必有已授权店铺，且红线要求不访问真实站点；**验证阶段不执行会真正打网关的 `call`**（如确需联调，由用户在自己已授权的环境执行）。
8. **回归**：`node test/test.js`（或 `npm test`）应全绿 —— 本次不触碰现有模块，预期无回归。
9. **产出物复核**：确认 `shopee_skill/` 4 个 lib + cli + SKILL.md、`.trae/skills/shopee-query/SKILL.md` 均已落盘；`git status` 检查无凭证 / 无 `server/data/` 混入。

## 8. 已知风险

- **网关参数无元数据**：目录只有接口名，没有参数表，CLI 无法在前端做参数校验 —— 参数错误只能由网关返回；已在 SKILL.md 引导「先查官方文档 + 最小参数验证」。
- **翻页语义靠响应键推断**：极端接口（既无 `more` 又需翻页、或一个响应含多个数组）可能漏翻或选错列表键；已用 `--max-pages` 兜底并在文档中提示可手动传翻页参数。
- **`api/README.md` 表格解析**：官方改版表格格式会导致模块中文名回退为英文（不影响取数），不影响 `list/call` 主功能。
- **CLI 与仓库强耦合**：见「关键决策 1」，这是用户明确选定的取舍。
