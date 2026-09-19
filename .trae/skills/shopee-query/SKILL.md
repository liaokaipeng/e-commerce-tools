---
name: "shopee-query"
description: "查询 Shopee 开放平台数据（订单/商品/库存/广告/资金/售后等 450+ 接口）。当用户要查店铺的 Shopee 数据、或提到 shopee 订单/商品/库存/评价时调用。底层复用仓库 openapi client 与已授权店铺凭证。Invoke when user asks to query Shopee shop data."
---

# Shopee 数据查询（注册入口）

本 skill 的**完整说明、全部选项与示例**见仓库根目录 `shopee_skill/SKILL.md` —— **执行前先读取它**（命令与选项只在那一处维护，本文件不复述，避免两处口径漂移）。

- **可执行入口**：`node shopee_skill/cli.js <命令>`（在仓库根目录执行；复用开放平台已授权凭证，**无需启动服务**）。
- **前置**：已在工具的「开放平台」页配置 App 并完成店铺授权（凭证存 `server/data/openapi-session.json`，gitignored）。
- **红线**：**默认只读**，写操作需 `--allow-write`（确认影响前先用 `--dry-run` 预览）；不得在任何命令或输出中打印、提交真实凭证。
- **「重点店铺」筛选**：`shops` 与 `--shop all` 默认只作用于重点店铺（一个都没勾选时为全部已授权店铺）；`--all-shops` 可忽略筛选。
