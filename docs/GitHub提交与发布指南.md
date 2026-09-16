# GitHub 提交与发布指南

> 面向**发布方 / 协作者**：如何把代码提交到 GitHub、如何发布 Release、以及相关注意事项。
> 本机为 Windows + PowerShell 5，**未安装 `gh` CLI**，远程操作统一走 `git` + GitHub REST API。
> 仓库地址与账号以各自 `git remote -v` 为准；版本号来源、打包与一键更新链路见《[架构](架构.md)》§1.3。

## 1. 前置：凭据与环境

- **凭据来源**：Git Credential Manager（GCM，随 Git for Windows 安装）。交互式 shell 里 `git push` 首次会弹窗登录 GitHub，之后免密——即凭据已在册。
- **必须显式用系统 git（`D:\Git\cmd\git.exe`），不要用 PATH 里的那个**：本机 PATH 首位是 WorkBuddy 自带的 **PortableGit**（`C:\Users\84463\.workbuddy\binaries\PortableGit\versions\<ver>\mingw64\bin\git.exe`），它的 GCM 在**无交互（自动化）环境**下会**无限挂起**——实测 `git credential fill` / `git push` 卡死 25 秒以上直到超时，且无任何输出，极难判断是「网络慢」还是「在等弹窗」。系统 git 的 GCM 直接从 Windows 凭据管理器读 `git:https://github.com`，**1.7 秒返回**，无需交互。
  - 本地操作（`add` / `commit` / `tag`）用哪个 git 都行；**一旦涉及远端（`push` / `fetch` / `credential fill`）就换成完整路径的系统 git**。
  - 排查用：`spawnSync('D:/Git/cmd/git.exe', ['credential','fill'], { input: 'protocol=https\nhost=github.com\n\n', env: {...process.env, GCM_INTERACTIVE:'never', GIT_TERMINAL_PROMPT:'0'}, timeout: 30000 })`，返回的 `password=` 即 OAuth token（`gho_` 开头，40 字符），可直接用作 `Authorization: Bearer`（实测能建 Release 与上传资产）。
- **访问 GitHub 的下载/API 域名要挂本机代理**：直连 `github.com:443` 会超时（实测 21 秒 `Could not connect to server`）。git 已配 `http.https://github.com.proxy=http://127.0.0.1:7897`，但 **Node 的 `fetch` 与 `curl` 都不读 git 配置**——用 `curl -x http://127.0.0.1:7897`，或给 fetch 显式配代理。
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

### 2.4 提交前检查（红线）：敏感信息与安全自检

**每次 `git commit` / `git push` 前必做，不可跳过、不可凭印象。** 本仓库大量文件（会话、抓包、店铺授权、日志）天然含真实凭证，一旦推上去就是不可撤销的泄露。

**第一步：范围确认**——看清这次到底动了什么，逐条确认每个文件「该不该进仓库」：

```powershell
git status --short                 # 新增/修改/未跟踪，逐个文件过目
git diff --cached --name-only      # 本次实际暂存了哪些文件
git diff --cached                  # 必须看内容，不能只看文件名
```

**第二步：内容扫描**——**文件名干净 ≠ 内容干净**。示例代码、文档、测试 fixture、注释、提交信息、Release 正文与附件里同样不得出现真实凭证，一律换成占位符（如 `SID=xxxxxx`）；文档/脚本里的本机绝对路径与用户名（`C:\Users\<你的用户名>\...`）一并替换为占位符。

```powershell
# 扫暂存内容；对已入库内容改用：git grep -n -I -E '<同样的模式>'
git diff --cached | Select-String -Pattern 'SID=|spc_|SPC_|Bearer\s|Authorization:|access_token|refresh_token|AKIA|secret|password|BEGIN [A-Z ]*PRIVATE KEY'
```

> 关键词扫描只是兜底：Cookie 值是长串十六进制或含 `%` 转义，抓不全。真正可靠的是「先想清这个文件属于哪一类、该不该入库」，而不是靠模式匹配过关。

**第三步：永不入库清单**（已在 `.gitignore` 中，若仍出现在暂存列表说明规则缺失）：

| 类别 | 具体 |
|---|---|
| 会话 / 凭证 | `server/data/`（真实店铺授权）、`*-session.json`、`settings.json`、`.env` 类文件 |
| 抓包数据 | `*.har`、`research/`（Playwright 抓包脚本含登录态）、`har/` 目录 |
| 本地产物 | `node_modules/`、`frontend/dist/`、`build/`、`backup/`、`*.xlsx` 导出、`bin/`（ffmpeg） |
| 个人信息 | 真实店铺名 / shop_id 清单、代理地址与账密、邮箱、本机用户名与绝对路径、截图（浏览器/DevTools 截图常带 Cookie 与店铺后台，慎入文档） |

**第四步：泄露处置**——若敏感信息**已经推上去**：

1. **第一时间作废并重签该凭证**（重新登录换取新 Cookie / token，GitHub token 去 Settings → Developer settings 撤销）。**删文件、改工作树、force push 都不解决已泄露的问题**，凭证作废才是唯一有效的止损。
2. 需要清历史时用 `git filter-repo` / BFG 重写后强推——这是「禁 force push `main`」（§2.5）的**唯一例外**，且必须先告知协作者、确认无人基于该历史工作。
3. 顺带排查同批推送的其它出口：Release 资产（zip 内是否含 `server/data/`）、Actions 日志、gist 与本地临时文件。

> 补 `.gitignore` 规则优先于「这次小心一点」：规则缺失时靠注意力兜底，早晚漏一次。

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

- 包内**不含 `node_modules`**（首次由 `启动.bat` 自动 `npm install`）、**`server/data`**（真实店铺授权、Cookie 永不进包，也永不被更新覆盖）与 **`docs/`**（开发文档，不对外分发）。
- zip 用系统自带 `tar -a` 生成（条目分隔符为 `/`，跨平台解压不会出现反斜杠文件名）。
  **tar 必须显式列出顶层条目、不能传 `.`**（`pack.js` 已内置正确写法）：传 `.` 时 bsdtar 会把条目名写成 `./server/...`，Windows 资源管理器（双击打开 / 右键解压）显示为**空白 zip**，而 7-Zip 等第三方工具正常——极易误判为「包是空的」。发布后务必按 §3.6 用系统解压抽验一次。
- **中文文件名必须按 UTF-8 存储**（打包加 `--options hdrcharset=UTF-8`，`pack.js` 已内置）：bsdtar 默认按**当前代码页**（中文 Windows 即 GBK）写非 ASCII 条目名，且**不置** zip 的 UTF-8 标志位（通用位标志 bit 11）——这种包在中文 Windows 解压正常，发到 Linux / macOS / 英文 Windows 就变成 `????.bat`、`???????.md`。
  `pack.js` 会在打包后打印自检结果：正常为「编码 UTF-8（N 个条目）」；若打印「⚠ 编码 … 未按 UTF-8 存储」，说明本机 tar 不认识该选项（需 libarchive 3.3+），**此时不要发布**，先升级系统 tar 再重打。
- 打包脚本读 `package.json` 版本号，并对**最终 zip** 计算 `sha256` 写入 `update.json`——**先改版本号再打包**；`notes` 由打包脚本留空，发布方手工填写后提交。

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
> - **别用 PowerShell 5.1 跑这个脚本**：PS 5.1 会把「UTF-8 无 BOM 的 `.ps1`」按本机 ANSI 解码，含中文注释时反引号行接续会失效、注释甚至可能吞掉下一行（表现为 422 `body is not a string` 或 `-Headers 不是命令`）。**建 Release / 上传资产一律用 Node 跑**（Node 内置 `fetch` 发字节；取凭据用 `spawnSync('git', ['credential','fill'], { input: 'protocol=https\nhost=github.com\n\n' })`，配 `GCM_INTERACTIVE=never`），见 §4。

### 3.5 更新清单 `update.json`（客户端自更新）

- `npm run pack` 已生成根目录 `update.json`（含 `version` / `url` / `sha256` / `notes`），**需提交并推送到仓库**。
- ⚠️ **`notes`（更新说明）打包脚本只写空串，必须手工填写后再提交**——客户端「检查更新」直接展示这段文字，忘了填就是一片空白。`version` 从 `package.json` 读，`builtAt` / `commit`（打包时的 `HEAD`）/ `sha256` 由脚本自动写，**不要手改**。
- **重新打包会覆盖 `update.json`，把已填好的 `notes` 一起清掉**：只想重打包（例如替换资产）时，先用脚本读出 `notes` 存到变量/文件，跑完 `pack.js` 再写回；或在改完 `update.json` 后单独 commit（见 §3.7）。
- 客户端从**固定地址**拉清单：在 `server/config/update.json` 的 `manifestUrl` 填
  `https://raw.githubusercontent.com/<用户名>/<仓库>/<分支>/update.json`（地址格式见该文件注释）。
- 清单中的 `url` 必须指向 **Release 资产的永久地址**：
  `https://github.com/<用户名>/<仓库>/releases/download/v<版本>/kp_tools-v<版本>.zip`。
  地址若不一致，重新生成 / 修改 `update.json` 后再提交。
- `sha256` 由打包脚本对最终 zip 计算；客户端下载后校验不一致即终止更新，不会静默覆盖。

### 3.6 发布后核对

- Release 状态为已发布（非 draft），标题、正文、附件均可见；
- 附件可下载（对 `browser_download_url` 发 HEAD 应返回 200，且长度与本地 zip 一致）；
- **把下载到的 zip 用系统解压抽验一次**：能看到顶层条目（不是空白 zip），且中文文件名 `启动.bat`、`新手入门指南.md` 显示正常（Linux / macOS / 英文 Windows 上同样不乱码）。
- 客户端「检查更新」能识别到新版本。

### 3.7 替换已发布版本的资产（重新打包后）

已发布的 zip 本身有问题（条目名编码、漏文件等）要原地替换时，**不能直接覆盖上传**——GitHub 不允许同名资产重复上传（返回 422 `already_exists`），必须先删旧资产。

顺序（目的是把「清单 sha 与资产不符」的窗口压到最短）：

1. **先在本地 `commit` 新的 `update.json`，但不要推**；
2. `DELETE /repos/{owner}/{repo}/releases/assets/{asset_id}` 删旧资产（`asset_id` 取 `GET /releases/tags/v<版本>` 的 `assets[].id`）；
3. 用同一个响应里的 `upload_url` 上传新包：
   `POST https://uploads.github.com/repos/{owner}/{repo}/releases/{release_id}/assets?name=kp_tools-v<版本>.zip`，
   请求头 `Content-Type: application/zip`，body 用 `--data-binary @build/...zip`；
4. **立刻 `git push`** 更新清单，再按 §3.6 复核。

> 窗口期（旧资产已删、新清单未推）客户端拉到的清单 sha 与资产不匹配，这一次「检查更新」会校验失败并回落，属预期行为——所以要一口气做完，别中途停手。

- 上传响应里的 `digest: "sha256:<hex>"` 是 **GitHub 服务端**算的，可直接与本地 sha256 比对，比只信本地计算更硬。
- 替换后 `assets[].id` 会变（同名不同 id），别处若引用过旧 id 需同步。
- 复核别只看 `size` 对得上：重新下载一次资产，解析 zip 中央目录确认条目名与 UTF-8 标志位（§3.6）。

## 4. 常见坑速查

| 场景 | 正确做法 |
|---|---|
| 自动化里 `git push` / `credential fill` 弹窗挂起 | 先置 `$env:GCM_INTERACTIVE='never'` |
| `git push` / `git credential fill` **无任何输出地卡死**（几十秒到几分钟） | 十有八九是用了 PATH 里的 **PortableGit**，它的 GCM 在无交互环境下挂起；**改用系统 git 完整路径 `D:\Git\cmd\git.exe`**（见 §1） |
| 发布后想核对资产，下载却 `Could not connect` / `fetch failed` | 直连 GitHub 下载域名超时，**加 `-x http://127.0.0.1:7897`**（curl）或给 Node fetch 配代理；核对时比对 `sha256` 与 `update.json` |
| 管道给 `git credential fill` 喂 stdin 失败 | 改用**文件重定向 stdin**（`-RedirectStandardInput`） |
| PowerShell 里写 `&&` 或 heredoc | 不支持；多行提交信息用 `git commit -F <文件>` |
| Release 创建报 422 `body is not a string` | 把 `Get-Content` 结果强转 `[string]` 再交 `ConvertTo-Json`；**若改用 Node 跑则不会遇到**（见下一行） |
| 含中文注释的 `.ps1` 在 PS 5.1 里行接续失效 / 报 `-Headers 不是命令` | PS 5.1 按 ANSI 解码 UTF-8 无 BOM 脚本所致；**发布脚本（建 Release / 上传资产）改用 Node**：`fetch` 发字节 + `spawnSync('git',['credential','fill'],{input})` 取凭据 |
| 上传 Release 资产 404 | 用创建响应的 `upload_url`，勿手拼 `api.github.com` 路径 |
| 想替换已发布版本的资产，上传报 422 `already_exists` | GitHub 不允许同名资产覆盖上传；先 `DELETE /repos/{owner}/{repo}/releases/assets/<asset_id>` 删旧资产再传（顺序见 §3.7） |
| zip 在资源管理器里打开是空的 | tar 打包时传了 `.`，条目名带 `./` 前缀所致；显式列顶层条目（见 §3.2），重新打包并替换资产 |
| zip 里中文文件名在 Linux / macOS / 英文 Windows 解压乱码 | bsdtar 按本机代码页（中文 Windows = GBK）写条目名且不置 UTF-8 标志位；打包加 `--options hdrcharset=UTF-8`（`pack.js` 已内置），并确认打包输出没有「⚠ 编码」警告（见 §3.2） |
| 误把凭证 / 数据提交上去 | 靠 `.gitignore`（`server/data/`、`*-session.json`、`*.har` 等）；漏网先补规则；**已推送即视为泄露，立刻作废该凭证**，流程见 §2.4 |
| 远端落后导致推送被拒 | `git pull --rebase` 后再推；**禁 force push `main`** |
