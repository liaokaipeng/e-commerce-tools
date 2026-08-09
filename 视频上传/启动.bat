@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo 正在启动 Shopee 视频批量上传服务...
start /B node main.js > server.log 2>&1
timeout /t 2 /nobreak >nul
start "" "http://localhost:3000"

echo.
echo 服务已启动，浏览器应已打开 http://localhost:3000
echo 日志同时写入 server.log
echo 关闭此窗口或按任意键即可停止服务。
pause >nul
taskkill /F /IM node.exe >nul 2>&1
exit
