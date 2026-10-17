// 前端接口请求辅助：统一 JSON 请求样板，避免各页面各写一份 fetch + JSON.parse。
// 两种语义分工：
// - 宽容（postJson / getJson）：解析失败降级为 {}，适合调用方本就允许响应体缺失的场景；
// - 严格（postJsonResult / getJsonResult）：网络异常或响应非 JSON 时 r.json() 自然抛出，由调用方 catch 统一提示，错误处理语义与手写 fetch + r.json() 逐字一致。
export async function postJson(url, body) {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return r.json().catch(() => ({}));
}

export async function getJson(url) {
  const r = await fetch(url);
  return r.json().catch(() => ({}));
}

/** 严格语义 POST：网络异常 / 响应非 JSON 时抛出（调用方 catch 统一提示）。
 *  @returns {Promise<{ok: boolean, data: object}>} ok = HTTP 2xx 且业务体 data.ok === true */
export async function postJsonResult(url, body) {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await r.json();
  return { ok: r.ok && !!data && data.ok === true, data: data || {} };
}

/** 严格语义 GET：网络异常 / 响应非 JSON 时抛出（调用方 catch 统一提示） */
export async function getJsonResult(url) {
  const r = await fetch(url);
  return r.json();
}
