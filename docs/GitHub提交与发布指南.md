# GitHub 提交与发布指南

> 面向**发布方 / 协作者**：如何把代码提交到 GitHub、如何发布 Release、以及相关注意事项。
> 本机为 Windows + PowerShell 5，**未安装 `gh` CLI**，远程操作统一走 `git` + GitHub REST API。
> 仓库地址与账号以各自 `git remote -v` 为准；版本号来源、打包与一键更新链路见《[架构](架构.md)》§1.3。

## 1. 前置：凭据与环境

- **凭据来源**：Git Credential Manager（GCM，随 Git for Windows 安装）。交互式 shell 里 `git push` 首次会弹窗登录 GitHub，之后免密——即凭据已在册。
- **无 `gh` CLI**：需要打 API（建 Release、建仓库等）时，先用 `git credential fill` 读出 token，再调 GitHub REST API。
- **取 token**（PowerShell 5，须用**文件重定向**喂 stdin）：

```powershell
$env:GCM_INTERACTIVE='never'   # 防止自动化场景弹窗挂起
[System.IO.File]::WriteAllText('.git\_cred_in.txt', "protocol=https`nhost=github.com`n`n")
Start-Process git -ArgumentList 'credential','fill' `
  -RedirectStandardInput '.git\_cred_in.txt' `
  -RedirectStandardOutput '.git\_cred_out.txt' `
  -RedirectStandardError '.git\_cred_err.txt' -NoNewWindow -Wait
# token 在 _cred_out.txt 的 password= 行
```

- **安全红线**：token 只在进程变量中使用，**禁止回显、禁止写入入库文件**；临时脚本与正文文件放 `.git/`（不入库），用毕即删。

> 坑：脚本（含 `-File` 自动化终端）用管道 `| git credential fill` 喂 stdin 会失败，报 `fatal: refusing to work with credential missing protocol field`（来自 GCM）。**必须改用文件重定向 stdin**（如上），或内联执行。

## 2. 提交代码到 GitHub

### 2.1 首次：关联远程

```powershell
git remote add origin https://github.com/<用户名>/<仓库>.git
git branch -M main
git push -u origin main        # -u 记住上游，之后直接 git push
```

### 2.2 日常提交流程

```powershell
git status                     # 先看清改了什么、哪些文件未被跟踪
git add <文件...>              # 建议按文件精确添加；确需全量再用 git add -A
git commit -F .git\_msg.txt    # 多行提交信息写文件后用 -F（见 2.3）
git push origin main
```

### 2.3 提交信息与 PowerShell 约定

- 格式：**一行标题 + 要点列表**（标题下空一行，再逐条列）。

```
修复取消竞价待改进列表解析

- 修正 SPU 配置须全量回传（少传键等于删配置）
- 补充对应单元测试
```

- PowerShell **不支持 `&&` 与 heredoc**：多行提交信息先写成文件，再 `git commit -F <文件>`。

### 2.4 提交前检查（红线）

- 用 `git status` 确认没有误加：会话/凭证文件（`*-session.json`、`settings.json`）、`server/data/`、抓包 `*.har`、`node_modules/`、构建产物（`build/`、`frontend/dist/`）等。
- 上列已由 `.gitignore` 忽略；若仍出现在待提交列表，说明规则缺失，**先补 `.gitignore` 再提交**，绝不把真实店铺授权 / Cookie 推上去。

### 2.5 推送与冲突

- **禁止 force push `main`**（`--force` / `--force-with-lease`）。
- 推送被拒（远端有新提交）：先 `git pull --rebase` 再推；有冲突则解决后 `git rebase --continue`。

## 3. 发布 Release

### 3.1 版本号唯一来源

- 本项目：仓库根 `package.json` 的 `version`（打包、前端显示、更新比对三处共用，见 `server/lib/version.js`）。
- 其它仓库以自身约定为准（例如 Chrome 扩展以 `extension/manifest.json` 为准）。
- **只有版本号升高才算新版本**——自更新只认比当前更高的版本号。

### 3.2 打包产物

```powershell
npm run pack        # 产出 build/kp_tools-v<version>.zip + 根目录 update.json
```

- 包内**不含 `node_modules`**（首次由 `启动.bat` 自动 `npm install`）与 **`server/data`**（真实店铺授权、Cookie 永不进包，也永不被更新覆盖）。
- zip 用系统自带 `tar -a` 生成（条目分隔符为 `/`，跨平台解压不会出现反斜杠文件名）。
- 打包脚本读 `package.json` 版本号，并对**最终 zip** 计算 `sha256` 写入 `update.json`——**先改版本号再打包**。

### 3.3 打 tag 并推送

```powershell
git tag -a v1.0.0 -F .git\_tag.txt     # annotated tag，名称 = v<version>
git push origin main
git push origin v1.0.0                  # 只推单个 tag
```

### 3.4 建 Release 并上传安装包

**方式 A：网页操作（手动，最简）**

1. 打开 `https://github.com/<用户名>/<仓库>/releases/new`
2. 选择刚推送的 tag（如 `v1.0.0`），填标题，正文写更新说明
3. 把 `build/kp_tools-v<版本>.zip` 拖入附件区，发布

**方式 B：REST API（可脚本化）**

```powershell
# 1) 取 token（见 §1），放入 $tok
$headers = @{ Authorization = "Bearer $tok"; Accept = 'application/vnd.github+json'; 'User-Agent' = 'publisher' }

# 2) 创建 Release：正文存 UTF-8 文件后读取，必须先强转 [string]
$body = @{ tag_name = 'v1.0.0'; name = 'v1.0.0'; target_commitish = 'main';
           body = [string](Get-Content -LiteralPath '.git\_rel_body.md' -Raw -Encoding UTF8) } | ConvertTo-Json
$rel = Invoke-RestMethod -Method Post -Uri 'https://api.github.com/repos/<owner>/<repo>/releases' `
  -Headers $headers -Body ([System.Text.Encoding]::UTF8.GetBytes($body)) -ContentType 'application/json'

# 3) 上传资产：必须用创建响应里的 upload_url（uploads.github.com），不能自己拼 api.github.com 路径
$up = ($rel.upload_url -replace '\{\?name,label\}','') + '?name=kp_tools-v1.0.0.zip'
Invoke-RestMethod -Method Post -Uri $up -Headers $headers -ContentType 'application/zip' -InFile 'build\kp_tools-v1.0.0.zip'
```

> Release API 坑（已踩过）：
> - `body` 必须强转 `[string]`——PS 5.1 的 `ConvertTo-Json` 会把 `Get-Content` 的文件对象序列化进 body，GitHub 返回 422 `body is not a string`。
> - 资产上传只能走创建响应里的 `upload_url`；自行拼 `api.github.com/repos/.../releases/<id>/assets` 一律 404。
> - 正文按 UTF-8 字节发送，避免中文乱码。

### 3.5 更新清单 `update.json`（客户端自更新）

- `npm run pack` 已生成根目录 `update.json`（含 `version` / `url` / `sha256` / `notes`），**需提交并推送到仓库**。
- 客户端从**固定地址**拉清单：在 `server/config/update.json` 的 `manifestUrl` 填
  `https://raw.githubusercontent.com/<用户名>/<仓库>/<分支>/update.json`（地址格式见该文件注释）。
- 清单中的 `url` 必须指向 **Release 资产的永久地址**：
  `https://github.com/<用户名>/<仓库>/releases/download/v<版本>/kp_tools-v<版本>.zip`。
  地址若不一致，重新生成 / 修改 `update.json` 后再提交。
- `sha256` 由打包脚本对最终 zip 计算；客户端下载后校验不一致即终止更新，不会静默覆盖。

### 3.6 发布后核对

- Release 状态为已发布（非 draft），标题、正文、附件均可见；
- 附件可下载（对 `browser_download_url` 发 HEAD 应返回 200，且长度与本地 zip 一致）；
- 客户端「检查更新」能识别到新版本。

## 4. 常见坑速查

| 场景 | 正确做法 |
|---|---|
| 自动化里 `git push` / `credential fill` 弹窗挂起 | 先置 `$env:GCM_INTERACTIVE='never'` |
| 管道给 `git credential fill` 喂 stdin 失败 | 改用**文件重定向 stdin**（`-RedirectStandardInput`） |
| PowerShell 里写 `&&` 或 heredoc | 不支持；多行提交信息用 `git commit -F <文件>` |
| Release 创建报 422 `body is not a string` | 把 `Get-Content` 结果强转 `[string]` 再交 `ConvertTo-Json` |
| 上传 Release 资产 404 | 用创建响应的 `upload_url`，勿手拼 `api.github.com` 路径 |
| 误把凭证 / 数据提交上去 | 靠 `.gitignore`（`server/data/`、`*-session.json`、`*.har` 等）；漏网先补规则 |
| 远端落后导致推送被拒 | `git pull --rebase` 后再推；**禁 force push `main`** |
