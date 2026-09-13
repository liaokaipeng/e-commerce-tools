// 预览扫描组合式函数：调 preview 接口、回显店铺级日志、记录可操作条数与耗时。
// 与批量执行（useBatchJob）职责无关，独立成文件。
import { ref, computed } from 'vue';

/**
 * @param {object} o { url, log, summarize: (shop) => { ok, msg, count } }
 */
export function usePreviewScan({ url, log, summarize }) {
  const scanning = ref(false);
  const shops = ref([]);
  const done = ref(false);
  const totalCount = computed(() => shops.value.reduce((n, s) => n + (summarize(s).count || 0), 0));

  async function scan(body) {
    scanning.value = true;
    done.value = false;
    shops.value = [];
    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const j = await resp.json();
      if (!j || !j.shops) {
        log((j && j.msg) || '扫描请求失败', 'err');
        return false;
      }
      shops.value = j.shops;
      for (const s of j.shops) {
        const r = summarize(s);
        log(r.msg, r.ok ? 'ok' : 'err');
      }
      done.value = true;
      return true;
    } catch (e) {
      log('扫描请求失败：' + e.message, 'err');
      return false;
    } finally {
      scanning.value = false;
    }
  }

  return { scanning, shops, done, totalCount, scan };
}
