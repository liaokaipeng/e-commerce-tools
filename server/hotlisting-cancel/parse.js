'use strict';
// 取消注册 Hot Listing 的纯解析函数（便于单测）：SPU 输入解析、响应行提取、配置归一化与按店汇总。

/**
 * 解析用户输入的 SPU 列表：接受数组或换行/逗号/空格分隔的字符串，返回纯数字 ID 数组（去重保序）。
 * 含非法内容时返回 { error } 提示（纯函数，便于单测）。
 */
function parseSpuList(input) {
  const raw = Array.isArray(input) ? input.join('\n') : String(input || '');
  const tokens = raw.split(/[\s,;，；、]+/).map(s => s.trim()).filter(Boolean);
  const spus = [];
  const seen = new Set();
  const invalid = [];
  for (const t of tokens) {
    if (/^\d{5,20}$/.test(t)) {
      if (!seen.has(t)) { seen.add(t); spus.push(t); }
    } else {
      invalid.push(t);
    }
  }
  if (invalid.length) {
    return { error: `SPU ID 含非法内容（仅支持纯数字，每行一个）：${invalid.slice(0, 3).join('、')}${invalid.length > 3 ? ' 等' : ''}` };
  }
  if (spus.length === 0) return { error: '请先填写至少一个 SPU ID（在卖家中心商品列表/链接中可查）' };
  if (spus.length > 200) return { error: `SPU 数量过多（${spus.length} 个，上限 200），请分批操作` };
  return { spus };
}

/**
 * 从 get_rsku_vsku_list 的响应 data 中提取可取消注册的 SKU 行（纯函数，便于单测）。
 * 只保留同时满足两个条件的行：
 *   1) seller_decision=1（已注册，rsku_status=2 过滤后理论全为已注册，此处兜底防误取消）；
 *   2) qualification_flags=1（资格正常）。实测列表里存在 qualification_flags=0 的异常行
 *      （如 stock_unqualified），这类 SKU 无法取消注册，必须过滤，否则逐条取消会报错。
 * @returns {Array<{rskuId, vskuId, itemId, itemName, modelName, ritemId, vitemId, previewLink}>}
 */
function extractEnrolledSkus(data) {
  const rows = [];
  for (const entry of (data && data.vrsku_info_list) || []) {
    const v = entry.vsku_info || {};
    const r = entry.rsku_info || {};
    if (Number(r.seller_decision) !== 1) continue;
    if (Number(r.qualification_flags) !== 1) continue;
    if (!r.rsku_id || !v.vsku_id) continue;
    rows.push({
      rskuId: String(r.rsku_id),
      vskuId: String(v.vsku_id),
      ritemId: String(r.ritem_id || ''),
      vitemId: String(v.vitem_id || ''),
      itemName: String(r.title || v.title || ''),
      modelName: String(r.variation_name || v.variation_name || ''),
      previewLink: String((entry.vitem_info && entry.vitem_info.preview_link) || ''),
    });
  }
  return rows;
}

/**
 * 解析前端提交的 SPU 配置并归一化（纯函数，便于单测）：
 * 保留值为非空字符串的店铺（去除首尾空白），其余丢弃。
 * @param {Object} raw 前端提交的 { shopId: spuText }
 * @returns {Object} 归一化后的 { shopId: spuText }
 */
function normalizeSpuMap(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [k, v] of Object.entries(raw)) {
    if (!/^\d{1,20}$/.test(String(k))) continue;
    const text = String(v || '').trim();
    if (text) out[String(k)] = text;
  }
  return out;
}

/**
 * 汇总每个选中店铺要操作的 SPU 列表（纯函数，便于单测）。
 * 请求体携带 spuMap 时以其为完整当前状态（清空也生效）；否则回落到已保存配置。
 * @returns {{ perShop: Object<string, {spus?: string[], error?: string}>, validCount: number }}
 */
function resolvePerShopSpus(shopIds, bodySpuMap, savedConfig) {
  const hasBodyMap = bodySpuMap && typeof bodySpuMap === 'object' && !Array.isArray(bodySpuMap);
  const merged = hasBodyMap ? normalizeSpuMap(bodySpuMap) : { ...savedConfig };
  const perShop = {};
  let validCount = 0;
  for (const id of shopIds) {
    const text = merged[String(id)];
    if (!text) {
      perShop[String(id)] = { error: '未配置 SPU ID，请先在上方卡片填写并保存' };
      continue;
    }
    const { spus, error } = parseSpuList(text);
    if (error) {
      perShop[String(id)] = { error };
      continue;
    }
    perShop[String(id)] = { spus };
    validCount += spus.length;
  }
  return { perShop, validCount };
}

module.exports = { parseSpuList, extractEnrolledSkus, normalizeSpuMap, resolvePerShopSpus };
