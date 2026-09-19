---
name: "shopee-query"
description: "查询 Shopee 开放平台数据（订单/商品/库存/广告/资金/售后等 450+ 接口）。当用户要查店铺的 Shopee 数据、或提到 shopee 订单/商品/库存/评价时调用。底层复用仓库 openapi client 与已授权店铺凭证。Invoke when user asks to query Shopee shop data."
---

# Shopee 数据查询（注册入口）

本 skill 的**完整说明与用法**见仓库根目录 `shopee_skill/SKILL.md` —— 执行前先读取它。

可执行入口：`node shopee_skill/cli.js <命令>`（在仓库根目录执行；复用开放平台已授权凭证，无需启动服务）。

## 命令速查

```bash
node shopee_skill/cli.js shops [--names]         # 已授权店铺列表
node shopee_skill/cli.js search <关键词>          # 搜索接口
node shopee_skill/cli.js describe <接口名|路径>    # 接口元数据 + 官方文档链接
node shopee_skill/cli.js call <接口名|路径> --shop <ID|all> [--params '<json>'] [--all] [--raw]
node shopee_skill/cli.js help                    # 完整用法
```

- 前置：需已在本仓库「开放平台」页面配置 App 并完成店铺授权（凭证存 `server/data/openapi-session.json`，gitignored）。
- 红线：**默认只读**，写操作需 `--allow-write`；不可打印或提交凭证。
