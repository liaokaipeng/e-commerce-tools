@echo off
chcp 65001 >nul
title TikTok 无水印视频下载工具
cd /d "%~dp0"

echo ==========================================
echo    TikTok 无水印视频下载工具
echo ==========================================
echo.

rem 检查 Node.js
where node >nul 2>nul
if errorlevel 1 (
    echo [错误] 未检测到 Node.js，请先安装: https://nodejs.org/
    echo        安装后重新双击本文件即可。
    pause
    exit /b 1
)

rem 首次运行自动安装依赖
if not exist "node_modules" (
    echo 首次运行，正在安装依赖，请稍候...
    call npm install
    if errorlevel 1 (
        echo [错误] 依赖安装失败，请检查网络后重试。
        pause
        exit /b 1
    )
)

rem 检查端口是否已被占用（服务可能已在运行）
netstat -ano | findstr ":8737" | findstr "LISTENING" >nul
if %errorlevel%==0 (
    echo [提示] 服务已在运行（端口 8737 被占用），无需重复启动。
    echo        正在打开浏览器...
    start "" "http://localhost:8737"
    pause
    exit /b 0
)

rem 启动服务，并延迟 2 秒后自动打开浏览器
start "" /b powershell -NoProfile -Command "Start-Sleep -Seconds 2; Start-Process 'http://localhost:8737'"
node main.js

pause
