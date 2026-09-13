'use strict';
// 授权回调页（浏览器从官方授权页跳回这里）：内联 HTML，读取 query 中的
// code/shop_id/main_account_id，调 /api/openapi/auth-callback 换 token。
function callbackPageHtml() {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>开放平台授权回调</title>
<style>
  body { font-family: "Microsoft YaHei", sans-serif; background: #f4f6fb; display: flex; min-height: 100vh; align-items: center; justify-content: center; margin: 0; }
  .card { background: #fff; border-radius: 12px; box-shadow: 0 6px 24px rgba(0,0,0,.08); padding: 32px 40px; max-width: 560px; text-align: center; }
  h2 { margin: 0 0 12px; color: #23262f; }
  p { color: #4a5064; line-height: 1.7; word-break: break-all; }
  .ok h2 { color: #0a9d5c; } .fail h2 { color: #d64541; }
  .spinner { display: inline-block; width: 28px; height: 28px; border: 3px solid #e0e3ee; border-top-color: #ee4d2d; border-radius: 50%; animation: spin 0.8s linear infinite; margin-bottom: 12px; }
  @keyframes spin { to { transform: rotate(360deg); } }
</style>
</head>
<body>
<div class="card" id="card">
  <div class="spinner"></div>
  <h2>正在完成店铺授权…</h2>
  <p>正在用授权码换取访问令牌，请稍候。</p>
</div>
<script>
  (async function () {
    var card = document.getElementById('card');
    var q = new URLSearchParams(location.search);
    function show(ok, title, detail) {
      card.className = 'card ' + (ok ? 'ok' : 'fail');
      card.innerHTML = '<h2>' + title + '</h2><p>' + detail + '</p>';
      setTimeout(function () { location.href = '/'; }, 4000);
    }
    var code = q.get('code');
    var shopId = q.get('shop_id');
    var mainId = q.get('main_account_id');
    if (q.get('error')) { show(false, '授权被取消或失败', '官方授权页返回错误：' + q.get('error') + '。请回到「开放平台」页面重新生成授权链接。'); return; }
    if (!code) { show(false, '回调参数不完整', '未收到 code。请回到「开放平台」页面重新生成授权链接并重新授权。'); return; }
    if (!shopId && !mainId) { show(false, '回调参数不完整', '未收到 shop_id 或 main_account_id。请回到「开放平台」页面重新生成授权链接并重新授权。'); return; }
    try {
      var r = await fetch('/api/openapi/auth-callback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: code, shopId: shopId || '', mainAccountId: mainId || '' }),
      });
      var j = await r.json();
      if (r.ok && j.ok) {
        var cnt = (j.shopIds && j.shopIds.length) || 0;
        show(true, '店铺授权成功', '已授权并保存 ' + cnt + ' 个店铺，即将返回工具首页。可在「开放平台」页面查看和管理 Token。');
      } else {
        show(false, '换取令牌失败', (j.message || '未知错误') + '。请回到「开放平台」页面重新生成授权链接。');
      }
    } catch (e) {
      show(false, '本地服务异常', '调用本地服务失败：' + e.message + '。请确认 启动.bat 正在运行后重试。');
    }
  })();
</script>
</body>
</html>`;
}

module.exports = { callbackPageHtml };
