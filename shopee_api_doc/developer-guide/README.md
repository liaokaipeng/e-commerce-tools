# Shopee Open Platform 开发者指南目录（中文版）

> 数据来源：`/developer_guide/list`（en / zh-Hans），抓取于 2026-08-15。
> 官方页面：国际站 <https://open.shopee.com/developer-guide> ｜ 中国站 <https://open.shopee.cn/developer-guide>

说明：

- 中文标题优先采用官方中文名；官方未提供中文名的条目由本目录补充翻译并标注 †。
- 「编号」即文章 document_id，可直接拼出官方页面链接：`/developer-guide/{编号}`。

## 目录

- [快速入门（Getting Started）](#快速入门getting-started)（15 篇）
- [巴西｜开发者之旅（BRASIL | Jornada do Desenvolvedor）](#巴西开发者之旅brasil-jornada-do-desenvolvedor)（13 篇）
- [API 指引与流程（API Guidelines and Flows）](#api-指引与流程api-guidelines-and-flows)（28 篇）
- [服务条款（Terms of Use）](#服务条款terms-of-use)（5 篇）
- [散篇](#散篇)（1 篇）

## 快速入门（Getting Started）

| 中文标题 | 原文标题 | 编号 | 官方页面 |
|---|---|---|---|
| 概述 | Introduction | 4 | [EN](https://open.shopee.com/developer-guide/4) ｜ [中文](https://open.shopee.cn/developer-guide/4) |
| 注册开发者账号 | Developer account registration | 12 | [EN](https://open.shopee.com/developer-guide/12) ｜ [中文](https://open.shopee.cn/developer-guide/12) |
| App管理 | App management | 14 | [EN](https://open.shopee.com/developer-guide/14) ｜ [中文](https://open.shopee.cn/developer-guide/14) |
| API调用 | API calls | 16 | [EN](https://open.shopee.com/developer-guide/16) ｜ [中文](https://open.shopee.cn/developer-guide/16) |
| 消息推送 | Push Mechanism notifications | 18 | [EN](https://open.shopee.com/developer-guide/18) ｜ [中文](https://open.shopee.cn/developer-guide/18) |
| 授权与鉴权 | Authorization and Authentication | 20 | [EN](https://open.shopee.com/developer-guide/20) ｜ [中文](https://open.shopee.cn/developer-guide/20) |
| 沙箱测试 V2.0 | Sandbox Testing V2 | 644 | [EN](https://open.shopee.com/developer-guide/644) ｜ [中文](https://open.shopee.cn/developer-guide/644) |
| 服务商合作计划 † | Service Partner Program | 24 | [EN](https://open.shopee.com/developer-guide/24) ｜ [中文](https://open.shopee.cn/developer-guide/24) |
| V2.0 API 调用流程 † | V2.0 API Call Flow | 27 | [EN](https://open.shopee.com/developer-guide/27) ｜ [中文](https://open.shopee.cn/developer-guide/27) |
| CNSC API对接用户手册 | CNSC API Integration Guide | 28 | [EN](https://open.shopee.com/developer-guide/28) ｜ [中文](https://open.shopee.cn/developer-guide/28) |
| KRSC API 集成指南 † | KRSC API Integration Guide | 29 | [EN](https://open.shopee.com/developer-guide/29) ｜ [中文](https://open.shopee.cn/developer-guide/29) |
| V2.0 数据定义 † | V2.0 Data Definition | 31 | [EN](https://open.shopee.com/developer-guide/31) ｜ [中文](https://open.shopee.cn/developer-guide/31) |
| 申请获取敏感数据 | Requesting Access to Sensitive Data | 718 | [EN](https://open.shopee.com/developer-guide/718) ｜ [中文](https://open.shopee.cn/developer-guide/718) |
| 台湾新开发者审核 † | TW New Developer Audit | 732 | [EN](https://open.shopee.com/developer-guide/732) ｜ [中文](https://open.shopee.cn/developer-guide/732) |
| BR SPI App 创建用户指南 | BR SPI App Creation User Guide | 749 | [EN](https://open.shopee.com/developer-guide/749) ｜ [中文](https://open.shopee.cn/developer-guide/749) |

## 巴西｜开发者之旅（BRASIL | Jornada do Desenvolvedor）

### 从这里开始（Sua trilha começa aqui!）

| 中文标题 | 原文标题 | 编号 | 官方页面 |
|---|---|---|---|
| 开发一个集成 † | Desenvolva uma integração | 736 | [EN](https://open.shopee.com/developer-guide/736) ｜ [中文](https://open.shopee.cn/developer-guide/736) |
| 创建登录账号 † | Crie um login | 384 | [EN](https://open.shopee.com/developer-guide/384) ｜ [中文](https://open.shopee.cn/developer-guide/384) |
| 创建开发者账号 † | Crie a conta de desenvolvedor | 738 | [EN](https://open.shopee.com/developer-guide/738) ｜ [中文](https://open.shopee.cn/developer-guide/738) |
| 创建你的 App † | Crie seu App | 740 | [EN](https://open.shopee.com/developer-guide/740) ｜ [中文](https://open.shopee.cn/developer-guide/740) |
| 进行测试（沙箱） † | Realize testes (Sandbox) | 744 | [EN](https://open.shopee.com/developer-guide/744) ｜ [中文](https://open.shopee.cn/developer-guide/744) |
| 发布你的 App（上线） † | Publique seu App (Go Live) | 741 | [EN](https://open.shopee.com/developer-guide/741) ｜ [中文](https://open.shopee.cn/developer-guide/741) |
| 授权你的第一家店铺 † | Autorize sua primeira loja | 739 | [EN](https://open.shopee.com/developer-guide/739) ｜ [中文](https://open.shopee.cn/developer-guide/739) |
| 敏感数据 † | Dados Sensíveis (Sensitive Data) | 743 | [EN](https://open.shopee.com/developer-guide/743) ｜ [中文](https://open.shopee.cn/developer-guide/743) |
| 发起你的第一次 API 调用 † | Faça sua primeira chamada de API | 745 | [EN](https://open.shopee.com/developer-guide/745) ｜ [中文](https://open.shopee.cn/developer-guide/745) |
| 消息推送（Webhooks） † | Push Notifications (Webhooks) | 746 | [EN](https://open.shopee.com/developer-guide/746) ｜ [中文](https://open.shopee.cn/developer-guide/746) |
| 常见问题 † | Perguntas Frequentes | 735 | [EN](https://open.shopee.com/developer-guide/735) ｜ [中文](https://open.shopee.cn/developer-guide/735) |
| 参考资料 † | Referências | 737 | [EN](https://open.shopee.com/developer-guide/737) ｜ [中文](https://open.shopee.cn/developer-guide/737) |
| 提交工单前的注意事项 † | Boas práticas antes de abrir um ticket | 747 | [EN](https://open.shopee.com/developer-guide/747) ｜ [中文](https://open.shopee.cn/developer-guide/747) |

## API 指引与流程（API Guidelines and Flows）

| 中文标题 | 原文标题 | 编号 | 官方页面 |
|---|---|---|---|
| 创建商品文章指引 | Guidelines for Creating Product | 217 | [EN](https://open.shopee.com/developer-guide/217) ｜ [中文](https://open.shopee.cn/developer-guide/217) |
| 商品创建准备 | Product creation preparation | 209 | [EN](https://open.shopee.com/developer-guide/209) ｜ [中文](https://open.shopee.cn/developer-guide/209) |
| 创建商品 | Creating product | 211 | [EN](https://open.shopee.com/developer-guide/211) ｜ [中文](https://open.shopee.cn/developer-guide/211) |
| 创建全球商品 | Creating global product | 213 | [EN](https://open.shopee.com/developer-guide/213) ｜ [中文](https://open.shopee.cn/developer-guide/213) |
| 发布全球商品 | Publishing global product | 215 | [EN](https://open.shopee.com/developer-guide/215) ｜ [中文](https://open.shopee.cn/developer-guide/215) |
| 变体管理 | Variant management | 219 | [EN](https://open.shopee.com/developer-guide/219) ｜ [中文](https://open.shopee.cn/developer-guide/219) |
| 商品信息管理 | Product base info management | 221 | [EN](https://open.shopee.com/developer-guide/221) ｜ [中文](https://open.shopee.cn/developer-guide/221) |
| 价格库存管理 | Stock & Price Management | 223 | [EN](https://open.shopee.com/developer-guide/223) ｜ [中文](https://open.shopee.cn/developer-guide/223) |
| 订单管理 | Order Management | 229 | [EN](https://open.shopee.com/developer-guide/229) ｜ [中文](https://open.shopee.cn/developer-guide/229) |
| 首公里发货预报 | First Mile Binding | 225 | [EN](https://open.shopee.com/developer-guide/225) ｜ [中文](https://open.shopee.cn/developer-guide/225) |
| 退货退款管理 | Return Refund Management | 227 | [EN](https://open.shopee.com/developer-guide/227) ｜ [中文](https://open.shopee.cn/developer-guide/227) |
| SIP最佳实践 | SIP best practices | 261 | [EN](https://open.shopee.com/developer-guide/261) ｜ [中文](https://open.shopee.cn/developer-guide/261) |
| Shopee 站内广告接口最佳实践 | Shopee On-Platform Ads API Guide | 277 | [EN](https://open.shopee.com/developer-guide/277) ｜ [中文](https://open.shopee.cn/developer-guide/277) |
| 虾皮店到店 - 无包装隔日到 对接指南 | Shopee Xpress - Package-free Integration Guide | 677 | [EN](https://open.shopee.com/developer-guide/677) ｜ [中文](https://open.shopee.cn/developer-guide/677) |
| 即时零售对接指南 † | Instant Mart Integration Guide | 643 | [EN](https://open.shopee.com/developer-guide/643) ｜ [中文](https://open.shopee.cn/developer-guide/643) |
| 直播管理对接指引 | Livestream API Integration Guide | 669 | [EN](https://open.shopee.com/developer-guide/669) ｜ [中文](https://open.shopee.cn/developer-guide/669) |
| Shopee AMS 对接指引 | Shopee AMS API Integration Guide | 702 | [EN](https://open.shopee.com/developer-guide/702) ｜ [中文](https://open.shopee.cn/developer-guide/702) |
| Shopee Video API 对接指引 | Shopee Video API Integration Guide | 706 | [EN](https://open.shopee.com/developer-guide/706) ｜ [中文](https://open.shopee.cn/developer-guide/706) |
| Brand Portal 服务 API 对接指引 | Brand Portal Service API Integration Guide | 733 | [EN](https://open.shopee.com/developer-guide/733) ｜ [中文](https://open.shopee.cn/developer-guide/733) |

### 巴西｜本地专属指引（BRAZIL | Specific Local Guides）

| 中文标题 | 原文标题 | 编号 | 官方页面 |
|---|---|---|---|
| 订单类 API † | APIs de Order (Pedido) | 383 | [EN](https://open.shopee.com/developer-guide/383) ｜ [中文](https://open.shopee.cn/developer-guide/383) |
| 物流类 API † | APIs de Logistics (Logística) | 292 | [EN](https://open.shopee.com/developer-guide/292) ｜ [中文](https://open.shopee.cn/developer-guide/292) |
| 通过 OpenAPI 上传 NF-e（巴西电子发票）与数据脱敏 † | Como subir a NF-e através da OpenAPI e Mascaramento de Dados | 382 | [EN](https://open.shopee.com/developer-guide/382) ｜ [中文](https://open.shopee.cn/developer-guide/382) |
| 汽车配件：配件兼容性 † | AUTO PARTS: COMPATIBILIDADE DE AUTOPEÇAS | 378 | [EN](https://open.shopee.com/developer-guide/378) ｜ [中文](https://open.shopee.cn/developer-guide/378) |
| Shopee 直达配送 † | Shopee Entrega Direta | 290 | [EN](https://open.shopee.com/developer-guide/290) ｜ [中文](https://open.shopee.cn/developer-guide/290) |
| Shopee 官方履约（巴西） † | Fulfilled by Shopee (BR) | 568 | [EN](https://open.shopee.com/developer-guide/568) ｜ [中文](https://open.shopee.cn/developer-guide/568) |
| 卖家物流（报价 API） † | Logística do Vendedor (API de Cotação) | 286 | [EN](https://open.shopee.com/developer-guide/286) ｜ [中文](https://open.shopee.cn/developer-guide/286) |
| 报价 API（极速达）开发者指南 † | Quotation API (Entrega Expressa) Developer Guide | 697 | [EN](https://open.shopee.com/developer-guide/697) ｜ [中文](https://open.shopee.cn/developer-guide/697) |
| 开放平台日志工具 † | Ferramenta de Log da Open Platform | 381 | [EN](https://open.shopee.com/developer-guide/381) ｜ [中文](https://open.shopee.cn/developer-guide/381) |

## 服务条款（Terms of Use）

| 中文标题 | 原文标题 | 编号 | 官方页面 |
|---|---|---|---|
| 服务条款 | Terms of Service | 36 | [EN](https://open.shopee.com/developer-guide/36) ｜ [中文](https://open.shopee.cn/developer-guide/36) |
| 数据保护政策 | Data Protection Policy | 32 | [EN](https://open.shopee.com/developer-guide/32) ｜ [中文](https://open.shopee.cn/developer-guide/32) |
| 平台合作规则 | Platform Partner Rules | 34 | [EN](https://open.shopee.com/developer-guide/34) ｜ [中文](https://open.shopee.cn/developer-guide/34) |
| 台湾开发者审查 † | TW Developer Screening | 646 | [EN](https://open.shopee.com/developer-guide/646) ｜ [中文](https://open.shopee.cn/developer-guide/646) |
| Chatbot 服务条款 † | Chatbot Terms of Service | 723 | [EN](https://open.shopee.com/developer-guide/723) ｜ [中文](https://open.shopee.cn/developer-guide/723) |

## 散篇

| 中文标题 | 原文标题 | 编号 | 官方页面 |
|---|---|---|---|
| 申报你的 IP（白名单） † | Declare seus IPs | 742 | [EN](https://open.shopee.com/developer-guide/742) ｜ [中文](https://open.shopee.cn/developer-guide/742) |

---

† 标注为本目录补充翻译（官方暂无中文标题），仅供参考，以官方页面为准。
