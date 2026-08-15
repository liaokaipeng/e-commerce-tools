# Shopee 开放平台整站文档目录（中文整理版）

本目录是 [Shopee Open Platform](https://open.shopee.com) / [Shopee 开放平台](https://open.shopee.cn) 官方文档站点的**整站目录中文整理版**，供后续开发时快速定位与查阅官方文档。

## 收录内容（两份核心目录）

| 目录文档 | 内容 |
|---|---|
| [developer-guide/README.md](./developer-guide/README.md) | **开发者指南整站目录（中文版）**：全部 62 篇文章，按分类整理，中英对照、带文章编号与官方页面链接 |
| [api/README.md](./api/README.md) | **API 参考整站目录（v2，中文版）**：全部 30 个模块、454 个接口/条目，模块名中文化，接口带官方页面链接 |

## 目录结构

```
shopee_api_doc/
├── README.md                 # 本文件：总索引与抓取方法说明
├── developer-guide/
│   └── README.md             # 开发者指南整站目录（中文版）★核心
├── api/
│   └── README.md             # API 参考整站目录 v2（中文版）★核心
├── _tools/
│   └── fetch-docs.js         # 零依赖抓取+生成脚本（见下）
└── _raw/                     # 原始 JSON 快照（三份源数据）
    ├── guide_list_en.json    #   指南目录（英文站）
    ├── guide_list_cn.json    #   指南目录（中文站）
    └── doc_module_v2.json    #   API v2 模块树（全部模块与接口清单）
```

## 页面与数据接口的对应关系

官方页面均为 SPA（Nuxt），目录数据由页面 JS 调用内部接口获取，本目录即由这些接口生成：

| 数据 | 数据接口（GET，无需登录） |
|---|---|
| 开发者指南目录（英文站） | `https://open.shopee.com/opservice/api/v1/developer_guide/list?language_code=en` |
| 开发者指南目录（中文站） | `https://open.shopee.cn/opservice/api/v1/developer_guide/list?language_code=zh-Hans` |
| API v2 模块树 | `https://open.shopee.cn/opservice/api/v1/doc/module/?version=2` |

页面链接规律（供后续开发查阅时使用）：

- 指南文章页：`https://open.shopee.com/developer-guide/{文章编号}`（中文站同域名规则）
- 接口文档页：`https://open.shopee.cn/documents/v2/{api_name}?module={module_id}&type=1`
- 文档树内指南条目（Overview 模块）：`https://open.shopee.com/developer-guide?from=doc&id={条目编号}`

## 中文整理规则

- **分类与模块名**：给出中文译名并保留官方英文原名（如「联盟营销（AMS）」）。
- **指南文章标题**：优先采用官方中文名；官方未提供中文名的条目（含巴西站葡萄牙语文章）由本目录补充翻译，并标注 †，以官方页面为准。
- **接口名**：保持官方标识符（如 `v2.ams.get_open_campaign_added_product`）不变，这是调用接口时实际使用的名称。

## 如何更新/扩充

```bash
# 在 shopee_api_doc 目录下重新抓取并生成两份中文目录
node _tools/fetch-docs.js
```

- 官方更新文档后，重新运行脚本即可刷新目录与 `_raw/` 快照。
- 如需补充新的中文译名，编辑 `_tools/fetch-docs.js` 顶部的 `ZH_MODULE`、`ZH_OVERVIEW_ITEM`、`ZH_GUIDE_CATEGORY`、`ZH_GUIDE_OVERRIDE` 映射表后重新运行。

## 注意事项

- **翻译以官方为准**：† 标记的译名为本目录补充，仅作定位参考；开发对接时请以官方英文页面为准。
- **接口目录 ≠ 接口正文**：本目录提供的是「目录索引 + 官方页面链接」，单个接口的详细参数说明在官方页面查看（页面为动态加载，正文无法直接离线抓取到本目录）。
- **数据快照**：`_raw/` 内为抓取当日的原始 JSON，可用于比对官方变更。
- **访问来源**：以上数据接口为官方站点前端同源接口，仅供内部查阅与开发参考，请勿用于其它用途。
