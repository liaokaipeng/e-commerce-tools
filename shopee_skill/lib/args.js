'use strict';
// 极简命令行参数解析（零依赖）：供 shopee_skill/cli.js 使用。
// 约定：位置参数进 _；`--k=v` / `--k v` 进 flags；`--flag`（无值）为 true；--param 可重复。
const REPEATABLE = new Set(['param']);

function setFlag(flags, key, value) {
  if (REPEATABLE.has(key)) {
    if (!Array.isArray(flags[key])) flags[key] = [];
    flags[key].push(value);
    return;
  }
  flags[key] = value;
}

/** 解析 argv（不含 node 与脚本路径）。返回 { _, flags } */
function parse(argv) {
  const positional = [];
  const flags = {};
  const arr = Array.isArray(argv) ? argv : [];
  for (let i = 0; i < arr.length; i++) {
    const tok = String(arr[i]);
    if (tok === '--') {
      for (let k = i + 1; k < arr.length; k++) positional.push(String(arr[k]));
      break;
    }
    if (tok === '-h') { flags.help = true; continue; }
    if (tok.startsWith('--') && tok.length > 2) {
      const body = tok.slice(2);
      const eq = body.indexOf('=');
      if (eq >= 0) { setFlag(flags, body.slice(0, eq), body.slice(eq + 1)); continue; }
      const next = arr[i + 1];
      if (next === undefined || (typeof next === 'string' && next.startsWith('--'))) {
        setFlag(flags, body, true);
        continue;
      }
      setFlag(flags, body, String(next));
      i++;
      continue;
    }
    positional.push(tok);
  }
  return { _: positional, flags };
}

/** 布尔标志判定：true / 'true' / '1' / 'yes' 视为真 */
function bool(v) {
  return v === true || v === 'true' || v === '1' || v === 'yes';
}

/** 整数标志解析，非法时回退默认值 */
function intOf(v, def) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : def;
}

module.exports = { parse, bool, intOf };
