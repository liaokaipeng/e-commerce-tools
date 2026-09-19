---
name: "shopee-query"
description: "查询 Shopee 开放平台数据（订单/商品/库存/广告/资金/售后等 450+ 接口）。当用户要查店铺的 Shopee 数据、或提到 shopee 订单/商品/库存/评价时调用。底层复用仓库 openapi client 与已授权店铺凭证。Invoke when user asks to query Shopee shop data."
---

# Shopee 数据查询

本地 CLI 查 Shopee 开放平台数据，复用仓库已授权凭证，**无需启动服务**。在**仓库根目录**执行：

```bash
node shopee_skill/cli.js shops                                   # 1) 拿店铺 ID（含店铺名，零网关请求）
node shopee_skill/cli.js call get_order_list --shop <ID> --last 7d --page-size 100   # 2) 查数据
```

- **起步只要这两条**。接口名可用**唯一短名**（如 `get_order_list`），自动补全 `v2.order.get_order_list`，省掉「先 search 再 call」。
- 短名有歧义时报错并列出候选，补全全名重试即可。

## 常用接口速查

| 场景 | 接口 | 必填业务参数 |
|---|---|---|
| 店铺信息 | `v2.shop.get_shop_info` | 无 |
| 订单列表 | `v2.order.get_order_list` | `time_range_field` `time_from` `time_to` `page_size` |
| 订单详情 | `v2.order.get_order_detail` | `order_sn_list` |
| 发货单 | `v2.order.get_shipment_list` | `page_size` |
| 物流轨迹 | `v2.logistics.get_tracking_info` | `order_sn` |
| 商品列表 | `v2.product.get_item_list` | `offset` `page_size` `item_status` |
| 商品信息 | `v2.product.get_item_base_info` | `item_id_list` |
| 型号/库存 | `v2.product.get_model_list` | `item_id` |
| 商品评价 | `v2.product.get_comment` | `cursor` `page_size` |
| 退货退款 | `v2.returns.get_return_list` | `page_no` `page_size` |
| 打款/账单 | `v2.payment.get_escrow_list` | `release_time_from` `release_time_to` |
| 钱包流水 | `v2.payment.get_wallet_transaction_list` | `page_no` `page_size` |

时间窗用 `--last 7d`（或 `--from 2024-01-01 --to 2024-01-31`）自动补时间字段；拉全量加 `--all`。

## 常用选项

`--shop <ID|all>`（`all`＝重点店铺）· `--all-shops`（忽略重点店铺筛选）· `--last 7d` / `--from` / `--to` ·
`--page-size <n>` · `--all` / `--max-pages <n>`（默认 10）· `--param k=v` · `--params '<json>'` ·
`--select <path>` + `--fields a,b`（只取需要字段，省 token）· `--compact` · `--concurrency <n>`（`--shop all`，默认 8）

## 排错与红线

- 缺必填参数时**本地直接报错并内联参数名/类型/示例**，不必再跑 `describe`。
- 认证失败 → 到工具「开放平台」页重新授权；参数报错（`error_param` / `Wrong sign`）→ 先 `describe` 核对参数名，别按字面改。
- **默认只读**：写操作需 `--allow-write`（建议先 `--dry-run` 预览）；**不得打印或提交真实凭证**。

> 完整选项、翻页语义、重点店铺规则、全部 450+ 接口检索（`list` / `search` / `describe`）见仓库 `shopee_skill/SKILL.md`（本文件是稳定速查，口径以那份为准）。
