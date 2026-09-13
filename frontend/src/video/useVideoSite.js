// 视频上传页 · 站点派生：门户按站点拆入口，本页由 ?mode=cn|ph 固定站点。
// 由此派生 site / isPh / siteLabel，供凭证、上传等模块复用。
import { ref, computed } from 'vue';

/** 站点配置（门户已按站点拆成「跨境」「本土」两个入口，本页由 ?mode=cn|ph 固定） */
export const SITES = {
  cn: { key: 'cn', label: '跨境（.cn）' },
  ph: { key: 'ph', label: '本土-菲律宾（.ph）' },
};

export function useVideoSite() {
  const modeParam = new URLSearchParams(window.location.search).get('mode');
  const site = ref(SITES[modeParam] ? modeParam : 'cn');
  const isPh = computed(() => site.value === 'ph');
  const siteLabel = computed(() => SITES[site.value].label);
  return { site, isPh, siteLabel };
}
