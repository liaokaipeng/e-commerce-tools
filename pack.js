'use strict';
/**
 * 打包发布产物（`npm run pack`）
 *
 * 产出两个文件：
 *   build/kp_tools-v<版本>.zip   运行版安装包（不含 node_modules / server/data / 开发资产）
 *   update.json                  更新清单（版本号 + 下载地址 + sha256 + 更新说明），提交到仓库供客户端拉取
 *
 * 关键约定：
 *   - **不含 node_modules**：首次使用者由 `启动.bat` 自动 `npm install`（仅 3 个依赖），
 *     这样每次更新的下载量只有约 2MB，而不是几十 MB。
 *   - **不含 server/data**：真实店铺授权与 Cookie 绝不进包；使用者的 data 目录也永不被更新覆盖。
 *   - 清单里的 url 必须指向**永久地址**（建议 GitHub Release 资产），地址模板见下方 DOWNLOAD_URL_TEMPLATE。
 *   - 压缩用系统自带 tar（Windows 10 1803+ 内置 bsdtar）：它写出的 zip 条目分隔符是 `/`，
 *     非 Windows 侧解压不会出现反斜杠文件名（.NET 的 Compress-Archive / ZipFile 会有这个问题）。
 *     两个必须显式处理的坑（详见 main 里第 3 步的注释）：①必须列出顶层条目，传 `.` 会产生
 *     `./` 前缀导致资源管理器显示为空；②必须加 `--options hdrcharset=UTF-8`，否则中文文件名会按
 *     本机代码页（中文 Windows = GBK）存储且不置 UTF-8 标志位，非中文系统解压全是乱码。
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const { ROOT, currentVersion } = require('./server/lib/version');
const { tarPath, zipNameEncoding } = require('./server/lib/archive');
const { COPY_ITEMS } = require('./server/update');
// 说明：COPY_ITEMS 与一键更新的覆盖白名单是同一份，避免「包里有、更新不覆盖」这类漂移。

/**
 * 下载地址模板：${version} 会被替换为版本号。
 * 默认按 GitHub Release 资产组织（仓库体积不会因二进制膨胀）。
 */
const DOWNLOAD_URL_TEMPLATE =
  'https://github.com/liaokaipeng/e-commerce-tools/releases/download/v${version}/kp_tools-v${version}.zip';

const BUILD_DIR = path.join(ROOT, 'build');

/** 递归复制（跳过指定名字的目录），与运行时的 mergeCopy 行为一致 */
function copyTree(src, dest, skipNames = []) {
  if (skipNames.includes(path.basename(src))) return;
  const st = fs.statSync(src);
  if (st.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    for (const e of fs.readdirSync(src, { withFileTypes: true })) {
      copyTree(path.join(src, e.name), path.join(dest, e.name), skipNames);
    }
    return;
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

function gitCommit() {
  const r = spawnSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT, encoding: 'utf8' });
  return r.status === 0 ? String(r.stdout).trim() : null;
}

function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function main() {
  const version = currentVersion();
  const commit = gitCommit();
  const builtAt = new Date().toISOString();
  const zipName = `kp_tools-v${version}.zip`;

  // 1) 组装发布内容到临时 staging（避免把 build/ 自己复制进去）
  const staging = path.join(os.tmpdir(), `kp_tools-pack-${Date.now()}`);
  fs.mkdirSync(staging, { recursive: true });
  const staged = [];
  for (const item of COPY_ITEMS) {
    const src = path.join(ROOT, item);
    if (!fs.existsSync(src)) {
      console.log(`  · 跳过（不存在）：${item}`);
      continue;
    }
    copyTree(src, path.join(staging, item), item === 'server' ? ['data', 'build-info.json'] : []);
    staged.push(item);
  }

  // 2) 写入构建信息（随包分发，供 /api/version 显示 commit 与构建时间）
  fs.writeFileSync(
    path.join(staging, 'server', 'build-info.json'),
    JSON.stringify({ version, commit, builtAt }, null, 2) + '\n',
    'utf8',
  );

  // 3) 压缩：tar -a 按扩展名选 zip 格式
  //    注意 1：必须显式列出顶层条目，不能传 `.`——bsdtar 会把条目名写成 `./server/...`，
  //    Windows 资源管理器打开这种 zip 会显示为空（7-Zip 等第三方工具不受影响）。
  //    注意 2：`--options hdrcharset=UTF-8` 不能省——bsdtar 默认按**当前代码页**（中文 Windows 即
  //    GBK）写非 ASCII 条目名，且**不置** zip 的 UTF-8 标志位（通用位标志 bit 11），包发到
  //    Linux / macOS / 英文 Windows 解压出来是 `????.bat`、`???????.md`。显式指定后条目名以
  //    UTF-8 存储并置标志位；中文 Windows 解压照旧正常（解压器按标志位解码，不再猜代码页）。
  //    该选项需 libarchive 3.3+（Win10 1803 自带的 3.3.2 起均支持），打包后由第 5 步兜底自检。
  fs.rmSync(BUILD_DIR, { recursive: true, force: true });
  fs.mkdirSync(BUILD_DIR, { recursive: true });
  const zipFile = path.join(BUILD_DIR, zipName);
  const topItems = fs.readdirSync(staging);
  const r = spawnSync(
    tarPath(),
    ['--options', 'hdrcharset=UTF-8', '-a', '-c', '-f', zipFile, '-C', staging, ...topItems],
    { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 },
  );
  if (r.error || r.status !== 0) {
    console.error('打包失败：' + (r.error ? r.error.message : String(r.stderr || r.stdout).trim()));
    process.exitCode = 1;
    return;
  }

  // 4) 自检条目名编码：确认没有「含非 ASCII 名但未置 UTF-8 标志位」的条目。
  //    老版本 libarchive 不认识第 3 步的 --options 时不会报错，会静默写出 GBK 包，
  //    这里兜底报警（中文 Windows 解压不受影响，故只警告不中断）。
  const enc = zipNameEncoding(zipFile);

  // 5) 生成更新清单（sha256 必须对最终 zip 计算）
  const sha256 = sha256File(zipFile);
  const manifest = {
    version,
    builtAt,
    commit,
    url: DOWNLOAD_URL_TEMPLATE.replace(/\$\{version\}/g, version),
    sha256,
    notes: '',
  };
  const manifestFile = path.join(ROOT, 'update.json');
  fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2) + '\n', 'utf8');

  const sizeMB = (fs.statSync(zipFile).size / 1024 / 1024).toFixed(2);
  console.log('\n打包完成');
  console.log(`  版本      v${version}${commit ? ` (${commit})` : ''}`);
  console.log(`  安装包    build/${zipName}  ${sizeMB} MB`);
  console.log(`  清单      update.json`);
  if (enc.bad.length) {
    console.log(`  ⚠ 编码    ${enc.bad.length}/${enc.total} 个条目名未按 UTF-8 存储：${enc.bad.slice(0, 5).join('、')}${enc.bad.length > 5 ? ' 等' : ''}`);
    console.log('             本机 tar 未识别 --options hdrcharset=UTF-8（需 libarchive 3.3+），');
    console.log('             非中文系统解压这些条目会乱码——请升级系统 tar 后重新打包。');
  } else {
    console.log(`  编码      UTF-8（${enc.total} 个条目，跨平台解压不乱码）`);
  }
  console.log(`  内容      ${staged.join('、')}`);
  console.log('  不含      node_modules（首次由 启动.bat 自动安装）、server/data、docs/（开发文档）、研究/测试资产\n');
  console.log('下一步：');
  console.log(`  1. 把 update.json 提交并推送到仓库（客户端从这里读版本清单，地址要固定）`);
  console.log(`  2. 在 GitHub 建 Release（tag v${version}），把 build/${zipName} 作为资产上传`);
  console.log('  3. 若 Release 资产地址与 DOWNLOAD_URL_TEMPLATE 不一致，改 update.json 的 url 后重新提交');
  if (manifest.url.includes('<用户名>')) {
    console.log('\n  ⚠ update.json 里的 url 还是模板占位符：请先在 pack.js 顶部填好 DOWNLOAD_URL_TEMPLATE。');
  }
  console.log('');
}

main();
