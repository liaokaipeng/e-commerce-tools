# 电商工具箱

本地运行的多功能电商运营工具箱：**单服务、单端口（`http://127.0.0.1:8765`）、双击 `启动.bat` 即用**，凭证只存本机。

> 本文只做「入口 + 导航」：项目概览、功能一览、快速开始与文档索引；**细则一律以各负责文档为准**（同一事实只写一处，见 [AGENTS.md](AGENTS.md) 约束 10）。

## 功能一览

门户页以常驻 iframe 按 Tab 切换各功能页：

| Tab | 页面 | 做什么 |
|---|---|---|
| 视频下载 | `/tiktok/` | TikTok 无水印视频批量下载（无需账号） |
| 竞价导出 | `/bidding/` | Shopee 卖家中心获胜竞价数据 → Excel |
| 取消竞价 | `/bidding-cancel/` | 批量撤销「待改进」竞价（先预览，可暂停 / 继续 / 取消） |
| 取消Hot Listing | `/hotlisting-cancel/` | 按 SPU 批量取消注册已注册 SKU |
| 视频上传 | `/video/`（`?mode=cn` / `?mode=ph`） | Shopee 短视频批量上传，分「跨境」与「本土-菲律宾」两个入口 |
| 开放平台 | `/openapi/` | Shopee 开放平台 App 配置与店铺 OAuth 授权，为官方 Open API 功能统一提供登录入口 |
| 监控大屏 | `/monitor/` | 已授权店铺定时巡检六域，P0/P1/P2 三级告警大屏展示 |
| 视频压缩 | `/compress/` | 选一个文件夹，递归把所有视频压到 30MB / 1 分钟以内（纯本地，原文件不动） |

> 除「视频下载」与「视频压缩」外，其余功能都要先在「开放平台」页完成一次**授权店铺**（店铺列表来自授权结果）。

门户页侧栏按「Shopee / TikTok / 其他」三个分组展示上述 Tab。

## 技术栈

- **后端**：Node.js（CommonJS、无框架），运行时依赖仅 `exceljs`、`https-proxy-agent`、`socks-proxy-agent`
- **前端**：Vue3 SFC + Element Plus + Vite 多页构建（9 个 HTML 入口），监控大屏折线图用 ECharts
- **扩展**：MV3（`extension/`），把网页里的 Cookie / 凭证推送到本地服务
- 前端构建产物 `frontend/dist` 由后端托管；端口固定 `8765`
- **视频压缩**额外需要一个外部 `ffmpeg`（重编码靠它，Node 自己做不到）：首次使用在页面上点一次「下载并安装 ffmpeg」，装在仓库根 `bin/`（约 180MB，不入库、不进发布包、不随更新覆盖）；也可以自己装好后放进 `bin/`

实现细节见 [docs/架构.md](docs/架构.md) §3–§4。

## 快速开始

### 使用者

前提：Windows + Node.js ≥18 + Edge / Chrome。

1. 双击 **`启动.bat`**（首次自动安装依赖并构建前端）→ 浏览器自动打开 `http://127.0.0.1:8765`；黑窗口不要关。
2. 安装扩展：`edge://extensions`（Chrome 为 `chrome://extensions`）→ 开发人员模式 → 「加载解压缩的扩展」→ 选择仓库里的 `extension/` 目录。
3. 打开门户页「开放平台」Tab，完成 App 配置与店铺授权。

完整操作步骤与常见问题见 **[新手入门指南.md](新手入门指南.md)**（面向最终用户，自包含、不链接其它文档）。

### 开发者

```bash
npm i                                # 后端依赖

node server/main.js                  # 起后端 http://127.0.0.1:8765

cd frontend && npm install
npm run dev                          # 前端开发 http://localhost:5173（/api 代理到 8765）
npm run build                        # 构建到 frontend/dist（由 main.js 托管）

node test/test.js                    # 测试（等价 npm test）：单元 + 开放平台刷新链路 + 接口冒烟
npm run pack                         # 打包发布：build/kp_tools-v<版本>.zip + update.json 清单
```

改前端 `src` 后**必须**重建 `frontend/dist`（gitignored 产物）；新增工具页的完整步骤见 [docs/开发指南.md](docs/开发指南.md) §3。

## 文档导航

| 文档 | 内容 |
|---|---|
| [AGENTS.md](AGENTS.md) | 仓库概览、关键约束（红线）、文档地图、本机环境坑——动手前先读 |
| [docs/架构.md](docs/架构.md) | 总体架构、目录结构、**API 路由总表**、后端共享层与设计令牌约定 |
| [docs/开发指南.md](docs/开发指南.md) | 快速开始、新增工具步骤、**测试与调试**（含测试假失败的坑） |
| [docs/视频上传链路.md](docs/视频上传链路.md) | 视频上传链路全部细节（站点 / 凭证 / 签名 / 流式 / Job / 取消 / 幂等） |
| [docs/开放平台链路.md](docs/开放平台链路.md) | OAuth 流程、v2 签名、**token 刷新与失效语义** |
| [docs/监控大屏实现.md](docs/监控大屏实现.md) | 监控按需采集调度、六域采集口径、金额换算、告警引擎与存储 |
| [docs/监控大屏.md](docs/监控大屏.md) | 监控大屏使用者说明（完整口径、指标表、告警怎么读） |
| [docs/GitHub提交与发布指南.md](docs/GitHub提交与发布指南.md) | 提交代码、发布 Release 与 `update.json` 清单的流程与坑 |
| [新手入门指南.md](新手入门指南.md) | 最终用户操作（自包含） |
| [docs/shopee_api_doc/README.md](docs/shopee_api_doc/README.md) | Shopee 开放平台官方文档整站目录与抓取方式 |

## 不可违反的约定（红线）

只列结论，细则见 [AGENTS.md](AGENTS.md) 与上表对应文档：

- **极简零配置**：双击 `启动.bat` 即用，不加环境变量与额外安装步骤；后端不新增运行时依赖（视频压缩所需的 `ffmpeg` 是外部可执行文件、由页面一键下载到 `bin/`，不是 npm 依赖）。
- **接口还原，不做 UI 自动化**：直接调 Shopee 内部 HTTP 接口，不改造成 Playwright / Selenium。
- **端口固定 8765**；CORS 为本机来源白名单，**不要退回 `Access-Control-Allow-Origin: *`**。
- **凭证不入库、不外发**：凭证与监控数据统一在 `server/data/`（gitignored），日志不完整打印 Cookie / Authorization。
- **共享层必须复用**（后端 `server/lib/`、前端 `src/composables/` 等），不许各写一份；**样式一律取设计令牌**，不写死颜色与尺寸。
- **写操作要显式声明非幂等**（视频上传类接口），避免失败重放导致重复发布。

## 隐私与更新

- 凭证（Cookie / token / `partner_key`）只存本机 `server/data/`，对外一律打码。
- 发布包**不含** `server/data`；一键更新只按白名单覆盖程序文件，不会删除本地文件，更新前自动备份数据到 `backup/`，落盘后需重启服务才生效。
- 使用者可在门户页侧栏查看版本号并一键更新，流程见 [新手入门指南.md](新手入门指南.md)「更新版本」。

## 许可

MIT（见 [package.json](package.json)）
