---
name: "shopee-query"
description: "查询 Shopee 开放平台数据（订单/商品/库存/广告/资金/售后等 450+ 接口）。当用户要查店铺的 Shopee 数据、或提到 shopee 订单/商品/库存/评价时调用。底层复用仓库 openapi client 与已授权店铺凭证。Invoke when user asks to query Shopee shop data."
---

# Shopee 数据查询（shopee_skill）

用一个本地 CLI 查询 Shopee 开放平台（Open Platform v2）数据。**直接复用仓库既有的开放平台底座**（`server/openapi/client` 的 `callOpenApi`：自动 v2 签名 / 附带 access_token / 过期自动刷新 / 认证失败强制刷新一次重试），**无需启动 8765 服务**、无需另做 OAuth。

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
node shopee_skill/cli.js search order                   # 按关键词搜接口名/模块名
node shopee_skill/cli.js list --module 商品              # 按模块过滤（支持模块 ID 或中文/英文名）

# 2) 看接口元数据（apiPath / 方法 / 是否只读 / 官方文档链接）
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

# 待发货订单列表（查询类接口用 GET；时间窗为秒级时间戳）
node shopee_skill/cli.js call v2.order.get_order_list --shop 123456 --params '{"order_status":"READY_TO_SHIP","time_range_field":"create_time","time_from":1700000000,"time_to":1800000000,"page_size":100}'

# 商品列表
node shopee_skill/cli.js call v2.product.get_item_list --shop 123456 --params '{"item_status":"NORMAL","offset":0,"page_size":50}'

# 单品库存（--param 传单参数，值自动按标量解析）
node shopee_skill/cli.js call v2.product.get_model_list --shop 123456 --param item_id=123456789

# 自动翻页拉全量（自适应 cursor / offset / page_no，默认上限 10 页）
node shopee_skill/cli.js call v2.order.get_order_list --shop 123456 --all --max-pages 5 --params '{...}'

# 对「重点店铺」执行同一次查询（未标记任何重点店铺时为全部已授权店铺）
node shopee_skill/cli.js call v2.shop.get_shop_info --shop all

# 忽略「重点店铺」筛选，对全部已授权店铺执行
node shopee_skill/cli.js call v2.shop.get_shop_info --shop all --all-shops

# 查看网关原始响应（含 error / message / request_id，排查用）
node shopee_skill/cli.js call v2.shop.get_shop_info --shop 123456 --raw
```

输出统一为**美化 JSON**（默认输出载荷层 `response`；`--raw` 输出完整响应），可直接用管道或 `jq` 解析。

## 选项速查

| 选项 | 说明 |
|---|---|
| `--shop <ID\|all>` | 目标店铺；仅一个已授权店铺时可省略；`all` 为「重点店铺」（未标记任何重点店铺时为全部已授权店铺） |
| `--params '<json>'` | 业务参数 JSON 对象 |
| `--param k=v` | 单个业务参数，可重复；值自动解析 true/false/null/数字 |
| `--params-file <path>` | 从文件读取业务参数 JSON 对象 |
| `--method GET\|POST` | 显式指定方法（默认按接口名推断，见下） |
| `--all` / `--max-pages <n>` | 自动翻页与页数上限（默认 10） |
| `--allow-write` | 放行写操作接口（默认只读拦截） |
| `--raw` | 输出网关原始响应 |
| `--all-shops` | 忽略「重点店铺」筛选：`shops` 列出全部店铺、`--shop all` 针对全部已授权店铺 |

## 重点店铺（重要店铺筛选）

店铺很多时，用户可在工具的「开放平台」页面把常用店铺勾选为**重点店铺**（标记持久化在 `server/data/openapi-session.json` 的 `important` 字段）。

- **有任一重点店铺时**：`shops` 默认只列重点店铺；`--shop all` 只对重点店铺执行。
- **一个都没勾选时**：回落为全部已授权店铺（与未启用该功能时行为一致）。
- 显式 `--shop <店铺ID>` **不受筛选影响**，始终可单独指定任意已授权店铺。
- 需要无视筛选操作全部店铺时加 `--all-shops`。

## 方法与「默认只读」红线

- 接口方法按命名推断：名称末段以 `get / search / query / list / fetch / view / check / download` 开头 → **GET（只读）**；其余 → **POST（写操作）**。可用 `--method` 覆盖。
- **写操作默认被拒绝**（不发任何请求），必须显式加 `--allow-write`。调用写接口前务必确认影响。
- 本 CLI **不提供 token 刷新命令**：access_token 过期由 `callOpenApi` 自动续期，共享 token 组的整组续期语义在底座内部处理，切勿另写「逐店刷新」。

## 排错

- **认证类错误**（如提示凭证无效 / refresh token 失效）：到工具的「开放平台」页面**重新授权**该店铺（或主账号授权一次恢复整组），再重试。
- **参数报错**（`error_param` / 格式错 / `Wrong sign` / `error_unknown`）：网关文案常具误导性。**先按 `describe` 给出的官方文档链接核对参数名与必填项**，再用最小参数组合逐项验证，不要按字面改。
- 接口名/参数不确定时，用 `search` + `describe` 定位；官方接口资料目录见 `docs/shopee_api_doc/`。

## 接口目录数据源

接口目录离线解析自 `docs/shopee_api_doc/_raw/doc_module_v2.json`（模块中文名解析自 `docs/shopee_api_doc/api/README.md`）。官方文档更新后可运行：

```bash
node docs/shopee_api_doc/_tools/fetch-docs.js
```

## 红线（务必遵守）

- **不得**在任何命令、脚本或输出中粘贴/打印真实凭证（Cookie / access_token / partner_key）。
- 凭证文件 `server/data/openapi-session.json` 与任何抓包文件**不得**提交入库。
- 默认只读；写操作需 `--allow-write` 并确认影响。
