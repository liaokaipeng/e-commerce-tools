// Shopee 取消注册 Hot Listing：SPU 批量文本的纯解析 / 生成函数（无副作用、不依赖 Vue）。
// 导入弹窗用 parseBulkSpuText 解析粘贴文本；导出弹窗用 buildBulkSpuExport 生成可回灌的三列文本。

/**
 * 解析批量导入文本（纯函数）：每行一条「店铺标识 + SPU ID」。
 * 分隔符支持 Tab / 逗号 / 分号 / 竖线；若一个都没有，则把行尾的纯数字当 SPU、其余当店铺标识。
 * 店铺标识优先按店铺 ID 精确匹配，其次按店铺名匹配（忽略大小写与首尾空白）。
 * @returns {{ items: Array<{id,name,spu}>, unmatched: string[] }}
 */
export function parseBulkSpuText(text, storeList) {
  const byId = new Map();
  const byName = new Map();
  for (const s of storeList) {
    byId.set(String(s.id), String(s.name || ''));
    const n = String(s.name || '').trim().toLowerCase();
    if (n) byName.set(n, String(s.id));
  }
  const items = [];
  const unmatched = [];
  const seen = new Set();
  for (const line of String(text || '').split(/\r?\n/)) {
    const raw = line.trim();
    if (!raw) continue;
    let left = '';
    let right = '';
    const parts = raw.split(/[\t,;，；|]+/).map(s => s.trim()).filter(Boolean);
    if (parts.length >= 2) {
      left = parts[0];
      right = parts[1];
    } else {
      const m = raw.match(/^(.*?)\s+(\d{5,20})$/); // 店名可能含空格，故只认行尾数字为 SPU
      if (!m) { unmatched.push(raw); continue; }
      left = m[1].trim();
      right = m[2];
    }
    if (!/^\d{5,20}$/.test(right)) { unmatched.push(raw); continue; }
    const id = byId.has(left) ? left : byName.get(left.toLowerCase());
    if (!id || seen.has(id)) { unmatched.push(raw); continue; } // 同一店铺只取首条
    seen.add(id);
    items.push({ id, name: byId.get(id) || '', spu: right });
  }
  return { items, unmatched };
}

/**
 * 生成导出文本（纯函数）：把当前全量 SPU 配置输出成「店铺ID / SPU / 店铺名」三列（Tab 分隔），
 * 可原样粘回 Excel 或再用 parseBulkSpuText 导入。
 * @returns {{ count: number, text: string }}
 */
export function buildBulkSpuExport(spuMap, storeList) {
  const lines = [];
  for (const [id, v] of Object.entries(spuMap || {})) {
    const text = String(v || '').trim();
    if (!text) continue;
    const st = storeList.find(s => String(s.id) === id);
    lines.push(`${id}\t${text}\t${st ? st.name : ''}`); // 店铺ID / SPU / 店铺名（可原样再导入）
  }
  const count = lines.length;
  return { count, text: count ? lines.join('\n') : '（暂无已配置的店铺）' };
}
