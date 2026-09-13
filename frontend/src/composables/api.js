// 前端接口请求辅助：统一 JSON 请求样板，避免各页面各写一份 fetch + JSON.parse。
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
