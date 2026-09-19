---
name: "shopee-query"
description: "查询 Shopee 开放平台数据（订单/商品/库存/广告/资金/售后等 450+ 接口）。当用户要查店铺的 Shopee 数据、或提到 shopee 订单/商品/库存/评价时调用。底层复用仓库 openapi client 与已授权店铺凭证。Invoke when user asks to query Shopee shop data."
---

# Shopee 数据查询（shopee_skill）

用一个本地 CLI 查询 Shopee 开放平台（Open Platform v2）数据。**直接复用仓库既有的开放平台底座**（`server/openapi/client` 的 `callOpenApi`：自动 v2 签名 / 附带 access_token / 过期自动刷新 / 认证失败强制刷新一次重试），**无需启动 8765 服务**、无需另做 OAuth。

方法与必填参数取自官方文档元数据 `docs/shopee_api_doc/_raw/api_meta_v2.json`（由 `_tools/fetch-docs.js` 生成），不再靠接口名猜。

## 何时使用

- 用户要查询某店铺的 Shopee 数据：订单、商品、库存、广告、资金、退货退款、账户健康、评价等。
- 用户给出官方接口名（如 `v2.product.get_item_list`）或描述清楚要查什么，需要落到具体接口。

## 前置条件

1. 已在工具的「开放平台」页面配置 App（`partner_id` / `partner_key` / 环境），并完成**店铺授权**。
2. 凭证保存在 `server/data/openapi-session.json`（**gitignored，切勿提交或外泄**）。CLI 与本工具页面共用这份凭证。
3. 在仓库根目录执行命令：`node shopee_skill/cli.js ...`。

## 标准流程

先「找接口」→ 再看「接口元数据」→ 最后「调用」：

```bash
# 1) 列出/搜索接口（默认只列查询类；加 --writes 才含写操作）
node shopee_skill/cli.js list --modules                 # 查看全部模块（含中文名与接口数）
node shopee_skill/cli.js search order                   # 按关键词搜接口名/路径/模块名
node shopee_skill/cli.js list --module 商品 --keyword item   # 按模块 + 关键词过滤（支持模块 ID 或中文/英文名）

# 2) 看接口元数据（方法 / 必填与可选参数 / 分页键 / 错误码 / 官方文档链接）
node shopee_skill/cli.js describe v2.product.get_item_list

# 3) 调用
node shopee_skill/cli.js call v2.shop.get_shop_info --shop 123456
```

## 常用示例

```bash
# 已授权店铺列表（默认离线读取本地凭证，且只列「重点店铺」）
node shopee_skill/cli.js shops
node shopee_skill/cli.js shops --names        # 额外经 get_shop_info 补店铺名/地区（会产生少量网关请求）
node shopee_skill/cli.js shops --all-shops    # 忽略「重点店铺」筛选，列出全部已授权店铺

# 店铺信息（GET，无业务参数）
node shopee_skill/cli.js call v2.shop.get_shop_info --shop 123456

# 待发货订单列表（时间窗用 --last 自动补 time_from/time_to/time_range_field）
node shopee_skill/cli.js call v2.order.get_order_list --shop 123456 --last 7d --page-size 100

# 时间窗也支持显式端点：epoch 秒 / 13 位毫秒 / ISO 日期 / 相对 -7d
node shopee_skill/cli.js call v2.order.get_order_list --shop 123456 --from 2024-01-01 --to 2024-01-31 --page-size 100

# 商品列表
node shopee_skill/cli.js call v2.product.get_item_list --shop 123456 --params '{"item_status":"NORMAL","offset":0,"page_size":50}'

# 单品库存（--param 传单参数，值自动按标量解析）
node shopee_skill/cli.js call v2.product.get_model_list --shop 123456 --param item_id=123456789

# 自动翻页拉全量（自适应 cursor / offset / page_no，默认上限 10 页；返回带 pages/maxPages/truncated）
node shopee_skill/cli.js call v2.order.get_order_list --shop 123456 --last 30d --all --max-pages 5 --page-size 100

# 只取需要的字段（省 token；Windows 默认没有 jq，用内置 --select）
node shopee_skill/cli.js call v2.order.get_order_list --shop 123456 --last 7d --page-size 100 --select orders --compact

# 对「重点店铺」执行同一次查询（未标记任何重点店铺时为全部已授权店铺）
node shopee_skill/cli.js call v2.shop.get_shop_info --shop all --wrap

# 忽略「重点店铺」筛选，对全部已授权店铺执行（可调并发）
node shopee_skill/cli.js call v2.shop.get_shop_info --shop all --all-shops --concurrency 8 --fail-on-error

# 写操作：先用 --dry-run 预览将发送的方法/路径/参数，确认后再加 --allow-write
node shopee_skill/cli.js call v2.discount.add_discount --shop 123456 --params '{...}' --dry-run

# 查看网关原始响应（含 error / message / request_id，排查用）
node shopee_skill/cli.js call v2.shop.get_shop_info --shop 123456 --raw
```

输出默认是**美化 JSON**（单店输出载荷层 `response`；`--raw` 输出完整响应），可直接用管道解析；加 `--compact` 输出紧凑 JSON（省 token）。

## 选项速查

| 选项 | 说明 |
|---|---|
| `--shop <ID\|all>` | 目标店铺；仅一个已授权店铺时可省略；`all` 为「重点店铺」（未标记任何重点店铺时为全部已授权店铺） |
| `--all-shops` | 忽略「重点店铺」筛选：`shops` 列出全部店铺、`--shop all` 针对全部已授权店铺 |
| `--params '<json>'` | 业务参数 JSON 对象 |
| `--param k=v` | 单个业务参数，可重复；值自动解析 true/false/null/数字 |
| `--params-file <path>` | 从文件读取业务参数 JSON 对象 |
| `--method GET\|POST` | 显式指定方法（默认取官方文档元数据，缺失时按接口名推断） |
| `--last <dur>` | 时间窗：最近 N 时长（`7d` / `24h` / `30m`），自动补 `time_from` / `time_to` / `time_range_field` |
| `--from <t>` / `--to <t>` | 时间窗端点：epoch 秒 / 13 位毫秒 / ISO 日期时间 / 相对 `-7d` |
| `--page-size <n>` | `page_size` 简写 |
| `--all` / `--max-pages <n>` | 自动翻页与页数上限（默认 10；显式 `0` 表示不翻页、只要首屏） |
| `--concurrency <n>` | `--shop all` 时的跨店并发度，默认 5（上限 20） |
| `--select <path>` | 只输出指定路径（点分，支持数组下标），如 `orders.0.order_sn` |
| `--dry-run` | 只预览将发送的方法/路径/参数，不签名、不发包（写操作也可预览） |
| `--allow-write` | 放行写操作接口（默认只读拦截） |
| `--raw` | 输出网关原始响应 |
| `--wrap` | 统一输出信封 `{ ok, apiName, method, data\|shops }` |
| `--fail-on-error` | 多店部分失败时置非零退出码 |
| `--compact` | 紧凑 JSON（不加缩进，省 token） |

## 方法判定与「默认只读」红线

- 方法**优先取官方文档元数据**（详情里的 method 字段，1=POST 写、2=GET 读）；元数据缺失或接口未收录时，回退按命名推断（末段以 `get / search / query / list / fetch / view / check / download` 开头 → GET）。
- 动词推断会**误伤 `batch_get_*` 这类只读接口**（如实测 `v2.ams.batch_get_products_suggested_rate` 官方是 GET），因此只要 `api_meta_v2.json` 在，就以元数据为准。
- **写操作默认被拒绝**（不发任何请求），必须显式加 `--allow-write`；不清楚会改什么时先用 `--dry-run` 预览。
- 本 CLI **不提供 token 刷新命令**：access_token 过期由 `callOpenApi` 自动续期，共享 token 组的整组续期语义在底座内部处理，切勿另写「逐店刷新」。

## 参数校验与时间窗助手

- **调用前必填校验**：有元数据时，若缺少官方必填参数会**在本地直接报错**（不浪费一次网关往返），并提示可运行 `describe` 查看参数表。
- **未知参数提示**：传入官方参数表以外的字段会在 stderr 给出 JSON 提示（不拦截，但网关可能忽略或报错）。
- `--last/--from/--to/--page-size` 只在用户未显式给出同名字段时注入；若该接口参数表不含该字段则跳过并提示，避免给不接受的接口硬塞 `time_from` 导致 `error_param`。

## 翻页与「全量」语义

- `--all` 自适应三种翻页语义（`next_cursor` / `next_offset` / `more` + `page_no`），翻页键优先取自元数据。
- 合并结果在载荷层追加 **`pages` / `maxPages` / `truncated`**，并清掉首页残留的 `more` / `next_cursor` / `next_offset`：**`truncated: true` 表示被页数上限截断、不是全量**，需要更多数据时调大 `--max-pages`。
- 无翻页语义的接口加 `--all` 也只返回首屏，不报错。

## 重点店铺（重要店铺筛选）

店铺很多时，用户可在工具的「开放平台」页面把常用店铺勾选为**重点店铺**（标记持久化在 `server/data/openapi-session.json` 的 `important` 字段）。

- **有任一重点店铺时**：`shops` 默认只列重点店铺；`--shop all` 只对重点店铺执行。
- **一个都没勾选时**：回落为全部已授权店铺（与未启用该功能时行为一致）。
- **重点店铺全部失效时不静默回落**：CLI 直接报错并要求重新授权或显式加 `--all-shops`（避免写操作打到预期外的店）。
- 显式 `--shop <店铺ID>` **不受筛选影响**，始终可单独指定任意已授权店铺。

## 排错

- **认证类错误**（如提示凭证无效 / refresh token 失效）：到工具的「开放平台」页面**重新授权**该店铺（或主账号授权一次恢复整组），再重试。
- **参数报错**（`error_param` / 格式错 / `Wrong sign` / `error_unknown`）：网关文案常具误导性。**先按 `describe` 给出的参数表与官方文档链接核对参数名与必填项**，再用最小参数组合逐项验证，不要按字面改。
- **提示「无元数据 / 元数据文件缺失」**：运行 `node docs/shopee_api_doc/_tools/fetch-docs.js --meta-only` 刷新 `api_meta_v2.json`（需联网）；缺失时方法与必填会退回按接口名推断。
- 接口名/参数不确定时，用 `search` + `describe` 定位；官方接口资料目录见 `docs/shopee_api_doc/`。

## 接口目录与元数据数据源

- 接口目录离线解析自 `docs/shopee_api_doc/_raw/doc_module_v2.json`（模块中文名解析自 `docs/shopee_api_doc/api/README.md`）。
- 接口元数据来自 `docs/shopee_api_doc/_raw/api_meta_v2.json`（`https://open.shopee.cn/opservice/api/v1/doc/api/?api_id=<id>&version=2`，免鉴权）。官方文档更新后运行：

```bash
node docs/shopee_api_doc/_tools/fetch-docs.js            # 目录 + 元数据
node docs/shopee_api_doc/_tools/fetch-docs.js --meta-only # 只刷元数据
```

## 红线（务必遵守）

- **不得**在任何命令、脚本或输出中粘贴/打印真实凭证（Cookie / access_token / partner_key）。
- 凭证文件 `server/data/openapi-session.json` 与任何抓包文件**不得**提交入库。
- 默认只读；写操作需 `--allow-write` 并确认影响（建议先 `--dry-run`）。
