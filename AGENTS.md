# AGENTS.md

本文件为 AI 代理（及人类协作者）提供仓库工作上下文。请先通读再动手。

## 仓库概览

本仓库为**多工具工作区**（非单一应用），含三个**相互独立**的子项目，无共享代码/依赖/构建系统；按子项目独立处理，不跨目录建抽象。

| 目录 | 用途 | 形态 | 端口 |
|------|------|------|------|
| `下载tiktok无水印视频/` | TikTok 视频批量无水印下载 | 本地 Node HTTP 服务 + 静态前端 | 8737 |
| `竞价/` | Shopee 卖家中心竞价（获胜）导出 Excel | Node CLI + 浏览器扩展 | 8765（收 Cookie 时） |
| `视频上传/` | 按 xlsx 批量上传 Shopee VOD 并关联商品 | 本地 Node HTTP 服务 + 浏览器扩展 | 3000 |

## 技术栈 & 模块系统

- 运行时：Node.js ≥ 18 LTS；纯 JS（CJS/ESM 混用）；原生前端无打包；Manifest V3 扩展；npm 逐项目管理。
- Excel：`竞价` 用 `exceljs`；`视频上传` 前端用 `public/xlsx.full.min.js`。
- **CommonJS**：`下载tiktok无水印视频/`、`视频上传/`（`require`/`module.exports`）。
- **ESM**：`竞价/`（`import`），靠其 `package.json` 的 `"type": "module"` 启用；该字段只影响 Node 解析，浏览器扩展 `.js` 不受影响。
- 改代码时**保持文件原有模块风格**，不要混用。

## 项目格式约定（已统一）

新增子项目请沿用：入口 `main.js` / 文档 `使用说明.md` / 启动脚本 `启动.bat` / 带 `package.json`（零依赖可空 `dependencies`）与 `.gitignore`（忽略 `node_modules/`、凭证 `session.json`、`*.log`、导出的 xlsx）。

## 子项目结构速查

**下载tiktok无水印视频**：`main.js`（HTTP 入口，托管静态）→ `tiktok.js`（解析链接/提视频ID/代理检测/批量下载）→ `public/index.html` → `启动.bat`（首次自动 `npm i` + 自动开浏览器）；依赖 `undici` + `https-proxy-agent` + `socks-proxy-agent`。

**竞价**：`main.js`（ESM CLI，子命令 `login` 起 8765 收 Cookie / `export -s 店铺ID` 拉数据写 Excel）→ `extension/`（读 `seller.shopee.cn` 的 Cookie（含 HttpOnly）→ POST 到 `http://127.0.0.1:8765/api/cookie`）→ `启动.bat`（一键收 Cookie → 问店铺 ID → 导出）；依赖 `exceljs`；运行时产物 `session.json`（不入库）。

**视频上传**：`main.js`（零依赖 HTTP 服务，上传链路 `preupload → 分片upload → mergeFiles → reportupload → item/list → video/create`，自带按 host 维护的 Cookie 罐供分片会话）→ `public/index.html` + `xlsx.full.min.js` → `extension/background.js`（Service Worker，监听 `webRequest` 抓 Authorization/Cookie/ShopID → 推到 `http://localhost:3000`）→ `启动.bat`；运行时产物 `session.json` / `server.log`（不入库）。

## 运行与启动

```bash
cd 下载tiktok无水印视频 && npm i && node main.js      # http://localhost:8737

cd 竞价 && npm i
node main.js login                  # 等扩展推 Cookie 到 8765
node main.js export -s <店铺ID>      # 导出 Excel（需先有 session.json）

cd 视频上传 && node main.js         # http://localhost:3000（零依赖，无需 npm i）
```

扩展加载：Edge/Chrome 打开 `edge://extensions` 或 `chrome://extensions` → 开开发者模式 →「加载解压缩的扩展」→ 选对应子项目的 `extension/` 目录。

## 约定与约束

1. **极简零配置**：面向非技术用户，双击 `.bat` 即用；不加环境变量/额外安装步骤。
2. **不新增运行时依赖**：`视频上传` 刻意零依赖；`竞价` 仅 `exceljs`。
3. **不跨子项目提取公共代码**：独立分发，重复优于耦合。
4. **不破坏 `.bat` 流程**：改入口/端口时，同步改对应 `.bat` 与 `使用说明.md`。
5. **端口固定**：8737 / 8765 / 3000，扩展与文档已硬编码，勿随意换。
6. **接口还原，不用 UI 自动化**：`竞价` 与 `视频上传` 直接调 Shopee 内部 HTTP 接口，遵循抓包链路；不要改成 Playwright/Selenium。
7. **凭证不入库**：`session.json`、`server.log` 不提交；日志不完整打印 Cookie/Authorization。
8. **中文优先**：面向中文用户，文档/注释/用户文案用中文；代码标识符可英文。
9. **不主动新增文档文件**：用各子项目现有的 `使用说明.md`，按需更新。

## 测试（无自动化）

- TikTok 下载：启动后贴一个有效链接，确认能下载无水印 mp4。
- 竞价：`login` 收 Cookie → `export -s <真实店铺ID>`，确认 Excel 行数合理。
- 视频上传：xlsx 先只填 1 个视频跑通全流程，再加量。

## 常见坑

| 现象 | 解决 |
|------|------|
| TikTok 下载网络错误 | 开 VPN/代理（工具自动读取系统代理） |
| 竞价 `Failed to fetch` | 8765 服务没起，重跑 `.bat` |
| 竞价 403 / 登录失效 | 重新登录卖家中心 → 扩展重推 Cookie |
| 视频上传 401/403 / 上传失败 | 凭证过期，去短视频上传页手动传一次视频，扩展自动刷新 `session.json` |
| 端口占用 | 关残留 `node` 进程或旧黑窗口 |
