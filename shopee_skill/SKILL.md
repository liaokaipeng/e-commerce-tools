---
name: "shopee-query"
description: "查询 Shopee 开放平台数据（订单/商品/库存/广告/资金/售后等 450+ 接口）。当用户要查店铺的 Shopee 数据、或提到 shopee 订单/商品/库存/评价时调用。底层复用仓库 openapi client 与已授权店铺凭证。Invoke when user asks to query Shopee shop data."
---

# Shopee 数据查询（shopee_skill）

用一个本地 CLI 查询 Shopee 开放平台（Open Platform v2）数据。**直接复用仓库既有的开放平台底座**（`server/openapi/client` 的 `callOpenApi`：自动 v2 签名 / 附带 access_token / 过期自动刷新 / 认证失败强制刷新一次重试），**无需启动 8765 服务**、无需另做 OAuth。

方法与必填参数取自官方文档元数据 `docs/shopee_api_doc/_raw/api_meta_v2.json`（由 `_tools/fetch-docs.js` 生成），不再靠接口名猜。

## 最快用法（照抄即可）

在**仓库根目录**执行：

```bash
# 1) 先拿店铺 ID（直接读本地凭证缓存，含店铺名，零网关请求）
node shopee_skill/cli.js shops

# 2) 查数据（接口名可用唯一短名，自动补全 v2.<模块>. 前缀）
node shopee_skill/cli.js call get_order_list --shop <ID> --last 7d --page-size 100
node shopee_skill/cli.js call get_shop_info --shop <ID>
node shopee_skill/cli.js call get_order_list --shop <ID> --last 30d --page-size 100 --all   # 拉全量
```

**起步只需两条命令**：`shops` 拿 ID，再 `call`。接口名支持**唯一短名**（如 `get_order_list`），会自动补全为 `v2.order.get_order_list`；短名有歧义时报错并列出候选（等同搜索结果），补全全名重试即可。**这样省掉「先 search 再 call」的一次往返。**

## 常用接口速查（省掉 search / describe 往返）

| 场景 | 接口（可直接当短名用） | 必填业务参数 | 翻页 |
|---|---|---|---|
| 店铺信息 | `v2.shop.get_shop_info` | 无 | — |
| 订单列表 | `v2.order.get_order_list` | `time_range_field` `time_from` `time_to` `page_size` | cursor |
| 订单详情 | `v2.order.get_order_detail` | `order_sn_list`（逗号分隔） | — |
| 发货单列表 | `v2.order.get_shipment_list` | `page_size` | cursor |
| 物流轨迹 | `v2.logistics.get_tracking_info` | `order_sn` | — |
| 商品列表 | `v2.product.get_item_list` | `offset` `page_size` `item_status` | offset |
| 商品基础信息 | `v2.product.get_item_base_info` | `item_id_list` | — |
| 型号 / 库存 | `v2.product.get_model_list` | `item_id` | — |
| 商品评价 | `v2.product.get_comment` | `cursor` `page_size` | cursor |
| 退货退款 | `v2.returns.get_return_list` | `page_no` `page_size` | page |
| 打款 / 账单 | `v2.payment.get_escrow_list` | `release_time_from` `release_time_to` | page |
| 钱包流水 | `v2.payment.get_wallet_transaction_list` | `page_no` `page_size` | page |
| 店铺表现 | `v2.account_health.get_shop_performance` | 无 | — |

- **时间窗**类接口用 `--last 7d` 或 `--from 2024-01-01 --to 2024-01-31` 自动补 `time_from` / `time_to` / `time_range_field`，不必手写时间戳；**分页类记得给 `--page-size`**。
- 表里没有的接口：`search <关键词>` → `describe <接口名>` → `call`。（`search` 默认最多 20 条，命中更多会给出 `truncated` 提示，可加 `--limit 0` 或缩窄关键词。）

## 标准流程（表里没有的接口才需要）

```bash
node shopee_skill/cli.js list --modules                 # 全部模块（含中文名与接口数）
node shopee_skill/cli.js search order                   # 按关键词搜接口名/路径/模块名（默认最多 20 条）
node shopee_skill/cli.js list --module 商品 --keyword item   # 按模块 + 关键词过滤
node shopee_skill/cli.js describe get_order_list        # 方法 / 必填参数 / 分页键 / 文档链接（支持短名）
node shopee_skill/cli.js call get_shop_info --shop 123456
```

`describe` 默认输出精简参数表（`name/type/required/sample`）省 token；需要完整元数据（含参数说明）加 `--full`。

## 常用示例

```bash
# 店铺列表（默认只列「重点店铺」，带缓存店铺名）
node shopee_skill/cli.js shops
node shopee_skill/cli.js shops --all-shops    # 忽略「重点店铺」筛选，列出全部已授权店铺
node shopee_skill/cli.js shops --names        # 对未缓存的店铺联网补名/地区（少量网关请求）

# 店铺信息（GET，无业务参数）
node shopee_skill/cli.js call get_shop_info --shop 123456

# 待发货订单（时间窗用 --last 自动补 time_from/time_to/time_range_field）
node shopee_skill/cli.js call get_order_list --shop 123456 --last 7d --page-size 100

# 显式时间端点：epoch 秒 / 13 位毫秒 / ISO 日期 / 相对 -7d
node shopee_skill/cli.js call get_order_list --shop 123456 --from 2024-01-01 --to 2024-01-31 --page-size 100

# 商品列表（--param 传单参数，值自动按标量解析）
node shopee_skill/cli.js call get_item_list --shop 123456 --param item_status=NORMAL --param offset=0 --param page_size=50

# 单品库存
node shopee_skill/cli.js call get_model_list --shop 123456 --param item_id=123456789

# 拉全量（自适应 cursor / offset / page_no；page 风格并行拉取，返回带 pages/maxPages/truncated）
node shopee_skill/cli.js call get_order_list --shop 123456 --last 30d --all --max-pages 5 --page-size 100

# 只取需要字段（省 token）：--select 定位列表，--fields 裁剪字段
node shopee_skill/cli.js call get_order_list --shop 123456 --last 7d --page-size 100 \
  --select order_list --fields order_sn,order_status,total_amount --compact

# 对「重点店铺」执行同一次查询（未标记任何重点店铺时为全部已授权店铺）
node shopee_skill/cli.js call get_shop_info --shop all --wrap

# 忽略「重点店铺」筛选，对全部已授权店铺执行（可调并发）
node shopee_skill/cli.js call get_shop_info --shop all --all-shops --concurrency 12 --fail-on-error

# 写操作：先用 --dry-run 预览将发送的方法/路径/参数，确认后再加 --allow-write
node shopee_skill/cli.js call v2.discount.add_discount --shop 123456 --params '{...}' --dry-run

# 排查：输出网关原始响应（含 error / message / request_id）
node shopee_skill/cli.js call get_shop_info --shop 123456 --raw
```

输出：`shops` / `list` / `search` / `describe` 默认**紧凑 JSON**（省 token，`--pretty` 恢复缩进）；`call` 默认美化 JSON、加 `--compact` 省 token。单店输出载荷层 `response`，`--raw` 输出完整响应。

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
| `--concurrency <n>` | `--shop all` 时的跨店并发度，默认 8（上限 20） |
| `--limit <n>` | `list` / `search` 最多展示条数，默认 20（`0` = 不限） |
| `--select <path>` | 只输出指定路径（点分，支持数组下标），如 `order_list.0.order_sn` |
| `--fields <a,b,c>` | 裁剪对象/列表字段（常配合 `--select` 用在列表上），如 `--select order_list --fields order_sn,total_amount` |
| `--full` | `describe` 输出完整元数据（默认精简参数表） |
| `--pretty` | `shops` / `list` / `search` / `describe` 恢复缩进输出（默认紧凑） |
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

- **调用前必填校验**：有元数据时，若缺少官方必填参数会**在本地直接报错**（不浪费一次网关往返），**报错消息里已内联必填参数的名称/类型/示例**，通常无需再跑 `describe`。
- **未知参数提示**：传入官方参数表以外的字段会在 stderr 给出 JSON 提示（不拦截，但网关可能忽略或报错）。
- `--last/--from/--to/--page-size` 只在用户未显式给出同名字段时注入；若该接口参数表不含该字段则跳过并提示，避免给不接受的接口硬塞 `time_from` 导致 `error_param`。

## 翻页与「全量」语义

- `--all` 自适应三种翻页语义（`next_cursor` / `next_offset` / `more` + `page_no`），翻页键优先取自元数据。
- **page 风格并行拉取**：`page_no` 确定性递增、且首屏带 `total_count` 时，剩余页并发拉取（游标来自上一页响应的 cursor / offset 风格仍串行）。
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
