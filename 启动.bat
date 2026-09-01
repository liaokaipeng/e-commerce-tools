@echo off
cd /d "%~dp0"
title Tool Collection

echo ==========================================
echo   Tool Collection
echo   Shopee: Bidding Export / Bidding Cancel / Hot Listing Cancel / Video Upload
echo   TikTok: Video Download
echo   (Chinese UI is shown in the server output)
echo ==========================================
echo.

rem Check Node.js
where node >nul 2>nul
if errorlevel 1 (
    echo [ERROR] Node.js not found. Please install from: https://nodejs.org/
    echo         Then run this file again.
    pause
    exit /b 1
)

rem Install dependencies on first run
if not exist "node_modules" (
    echo First run: installing server dependencies, please wait...
    call npm install
    if errorlevel 1 (
        echo [ERROR] Dependency installation failed. Please check your network.
        pause
        exit /b 1
    )
)

rem Build frontend (Vite) on first run
if not exist "frontend\dist" (
    echo First run: installing and building frontend, please wait...
    cd /d "%~dp0frontend"
    call npm install
    if errorlevel 1 (
        echo [ERROR] Frontend dependency installation failed.
        pause
        exit /b 1
    )
    call npm run build
    if errorlevel 1 (
        echo [ERROR] Frontend build failed.
        pause
        exit /b 1
    )
    cd /d "%~dp0"
)

rem Check if port 8765 is already in use (service may already be running)
netstat -ano | findstr ":8765" | findstr "LISTENING" >nul
if %errorlevel%==0 (
    echo [INFO] Service already running, port 8765 in use.
    echo        Opening browser...
    start "" "http://127.0.0.1:8765"
    pause
    exit /b 0
)

rem Start service, open browser after 2 seconds
start "" /b powershell -NoProfile -Command "Start-Sleep -Seconds 2; Start-Process 'http://127.0.0.1:8765'"
node server\main.js

pause