// SSE 流传输组合式函数：读取 fetch 响应流并逐事件回调，供各工具页共用。

/** 读取 fetch SSE 响应流，逐条解析 data: 事件并回调 */
export async function readSSE(resp, onEvent) {
  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const parts = buf.split('\n\n');
    buf = parts.pop();
    for (const part of parts) {
      const line = part.split('\n').find((l) => l.startsWith('data: '));
      if (!line) continue;
      try { onEvent(JSON.parse(line.slice(6))); } catch { /* 忽略无法解析的事件 */ }
    }
  }
}

/**
 * 发起请求并读取 SSE 事件流：非 2xx 或响应体不可读时记日志并返回 false，
 * 否则逐事件交给 onEvent（内部复用 readSSE），读完后返回 true。
 * 供 bidding / bidding-cancel / hotlisting-cancel / tiktok 四页共用，
 * 替代各页逐字重复的「fetch → resp.ok 校验 → readSSE」样板。
 * @param {string} url 接口路径
 * @param {RequestInit} options fetch 选项（method / headers / body / signal 等）
 * @param {(ev: any) => void} onEvent 单个 SSE 事件回调
 * @param {(msg: string, cls?: string, title?: string) => void} log 页面日志函数
 * @returns {Promise<boolean>} 是否成功读取了事件流
 */
export async function runSSE(url, options, onEvent, log = () => {}) {
  const resp = await fetch(url, options);
  if (!resp.ok || !resp.body) {
    const err = await resp.json().catch(() => ({}));
    log(err.msg || err.message || '请求失败', 'err');
    return false;
  }
  await readSSE(resp, onEvent);
  return true;
}
