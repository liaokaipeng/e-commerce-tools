// 店铺「地区 + 关键词」筛选（StorePicker / VideoSteps 共用；useSpuConfig 复用其中的纯函数）。
// 地区选项按首次出现顺序去重；关键词同时匹配店名与店铺ID（大小写不敏感）；
// 被筛掉的项仍由各页渲染（保住已选标签名称），只是在下拉里隐藏（.opt-filtered-out）。
import { ref, computed } from 'vue';
import { regionLabel } from '../region-utils.js';

/** 关键词匹配纯函数：文本（如「店名 店铺ID」）含关键词即命中；空关键词恒真 */
export function matchShopKeyword(text, kw) {
  const k = String(kw || '').trim().toLowerCase();
  if (!k) return true;
  return String(text || '').toLowerCase().includes(k);
}

/**
 * @param {object} o
 *   - items    Ref<Array> 全量选项
 *   - regionOf (item) => 地区代码
 *   - textOf   (item) => 参与关键词匹配的文本（如「店名 店铺ID」/ 下拉 label）
 */
export function useShopFilter({ items, regionOf, textOf }) {
  const regionFilter = ref('');
  const keyword = ref('');
  const regionOptions = computed(() => {
    const set = new Map(); // code -> 原始出现顺序去重
    for (const it of items.value) {
      const code = String(regionOf(it) || '').toUpperCase();
      if (code && !set.has(code)) set.set(code, regionLabel(code));
    }
    return [...set.entries()].map(([value, label]) => ({ value, label }));
  });
  function onFilter(query) {
    keyword.value = String(query || '').trim();
  }
  const visible = computed(() => {
    const kw = keyword.value.toLowerCase();
    return items.value.filter((it) => {
      if (regionFilter.value && String(regionOf(it) || '').toUpperCase() !== regionFilter.value) return false;
      if (!kw) return true;
      return textOf(it).toLowerCase().includes(kw);
    });
  });
  return { regionFilter, keyword, regionOptions, onFilter, visible };
}
