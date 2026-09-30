---
name: "send-mail"
description: "通过本机 SMTP 发送邮件（零第三方依赖，默认 QQ 邮箱）。当用户要求发送邮件、发报告、邮件通知，或提到发邮件/收件人时调用。默认收件人为每日日报的两个固定收件人。Invoke when user asks to send an email or send a report by email."
---

# 本机邮件发送（send-mail）

用仓库本地脚本 `.trae/local/send-mail.js` 发送邮件：**仅用 Node 内置模块**（tls/net/fs），不引入任何第三方依赖，默认走 QQ 邮箱 SMTP（smtp.qq.com:465，SSL）。SMTP 凭证放在同目录 `mail-config.json`（已 gitignore，不入库、不进发布包）。

## 默认收件人

**默认收件人（两个，每日日报的固定收件人）**：真实地址**不写在本文件**（避免随仓库外发），维护在本机 `.trae/local/` 下（已 gitignore）；本文一律以 `<默认收件人1>` / `<默认收件人2>` 占位，使用时替换为真实地址。

用户未指定收件人时，用这两个地址作为 `--to`（逗号分隔一并传入）；用户明确指定其它收件人时，以用户指定为准。

## 最快用法（仓库根目录执行）

```bash
# 1) 自检：只组装邮件并打印预览，不连接、不发送（首次或改配置后先跑这个）
node .trae/local/send-mail.js --to <默认收件人1>,<默认收件人2> --subject 测试 --body 你好 --dry-run

# 2) 发纯文本
node .trae/local/send-mail.js --to <默认收件人1>,<默认收件人2> --subject 测试 --body 你好

# 3) 发 HTML（优先渲染 HTML；同时给 --body 时纯文本作兜底，自动 multipart/alternative）
node .trae/local/send-mail.js --to <默认收件人1>,<默认收件人2> --subject 日报 --html-file reports/xxx.html --body-file reports/xxx.txt

# 4) 抄送
node .trae/local/send-mail.js --to a@qq.com --cc b@qq.com --subject 标题 --body 正文
```

成功时 stdout 输出 JSON：`{"ok":true,"sent":2,"to":[...],"subject":"..."}`；失败时 stderr 给出原因、退出码 1。

## 选项速查

| 选项 | 说明 |
|---|---|
| `--to <v>` | 收件人，多个用逗号分隔（必填；用户未指定时用默认收件人） |
| `--subject <v>` | 邮件主题（必填；中文自动 RFC 2047 编码，不乱码） |
| `--body <v>` / `--body-file <p>` | 纯文本正文（直接传 / 读 UTF-8 文件） |
| `--html <v>` / `--html-file <p>` | HTML 正文（客户端优先渲染） |
| `--cc <v>` | 抄送，逗号分隔 |
| `--config <p>` | SMTP 配置路径，默认 `.trae/local/mail-config.json` |
| `--dry-run` | 只组装邮件并打印 JSON 预览（含 rawPreview），不连接、不发送 |
| `--help` | 打印用法 |

- `--body` 与 `--html` 至少给一个；两者都给 → `multipart/alternative`（客户端优先渲染 HTML，纯文本兜底）。
- 正文一律 base64 编码（76 列折行），中文安全，无需处理 dot-stuffing。

## 前提条件

`.trae/local/mail-config.json` 必须存在且填写 SMTP **授权码**（不是登录密码）。缺失时按同目录 `mail-config.example.json` 的格式创建：

```json
{
  "host": "smtp.qq.com",
  "port": 465,
  "secure": true,
  "user": "<发件邮箱>",
  "pass": "<SMTP 授权码>",
  "from": "<发件邮箱>",
  "fromName": "电商工具箱自动化"
}
```

- 必填项：`host` / `user` / `pass` / `from`；可选 `port`（默认 465）/ `secure`（默认 true，false 则走 587 STARTTLS）/ `fromName` / `clientName`。
- `pass` 仍是占位符 `YOUR_SMTP_AUTH_CODE` 时会直接报错，提示去邮箱「设置→账号」生成授权码。
- QQ 邮箱授权码路径：邮箱网页版 → 设置 → 账号 → POP3/IMAP/SMTP 服务 → 生成授权码。

## 排错

- 「缺少配置文件」→ 按上面格式创建 `mail-config.json` 并填授权码。
- 「SMTP 授权码尚未填写」→ `pass` 还是占位符，换成真实授权码。
- 「SMTP 步骤失败 [535]」→ 授权码错误/过期，或误填了登录密码（必须用授权码），重新生成再试。
- 「SMTP 连接超时」→ 检查本机网络/代理（脚本 20s 超时）。
- 不确定配置对不对 → 先 `--dry-run` 看预览 JSON，不真正发信。

## 与每日日报的关系（主要使用场景）

定时任务「重点店铺同比日报」每天 9:00 执行 `node .trae/local/daily-yoy-report.js`：抓重点店铺订单数据 → 生成 HTML 报告 → 调本技能同一个 `send-mail.js` 发到上述两个默认收件人；发信失败时报告落盘到 `reports/` 下，可人工补发。**人工补发**就用本技能：

```bash
node .trae/local/send-mail.js --to <默认收件人1>,<默认收件人2> \
  --subject "重点店铺最近7日日报 2026-09-29" \
  --html-file "reports/最近7日报告_2026-09-29.html"
```

脚本也可作为模块被其它自动化复用：`require('./send-mail')` 导出 `sendMail` / `loadConfig` / `buildMessage` / `splitList`。

## 红线

- **绝不打印 / 提交 SMTP 授权码**：脚本自身不打印 `pass`，也不要把它带进任何输出、日志、文档、提交信息。
- **默认收件人真实地址不进仓库**：只维护在本机 `.trae/local/`（已 gitignore），不要写进本文件或任何提交内容。
- `mail-config.json` 与整个 `.trae/local/` 已 gitignore，不要手动提交或打进发布包。
- 群发前先 `--dry-run` 确认收件人与主题无误再真发。
