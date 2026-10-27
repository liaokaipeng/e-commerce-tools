@echo off
setlocal enabledelayedexpansion
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

rem Check if port 8765 is already in use.
rem Auto-restart: double-clicking this file always runs the CURRENT code, even when
rem the old black window was never closed (the most common user mistake).
set "OLD_PID="
for /f "tokens=5" %%P in ('netstat -ano ^| findstr ":8765 " ^| findstr "LISTENING"') do set "OLD_PID=%%P"

if defined OLD_PID (
    rem Only restart when the listener is this project's own node server.
    powershell -NoProfile -ExecutionPolicy Bypass -Command "$p = Get-CimInstance Win32_Process -Filter ('ProcessId=' + %OLD_PID%) -ErrorAction SilentlyContinue; if ($p -and $p.Name -eq 'node.exe' -and $p.CommandLine -match 'server[\\/]main\.js') { exit 0 } else { exit 1 }"
    if errorlevel 1 (
        rem Port belongs to another program: never kill it, just open the browser.
        echo [INFO] Port 8765 is used by another program.
        echo        Opening browser...
        start "" "http://127.0.0.1:8765"
        pause
        exit /b 0
    )
    echo [INFO] Old instance detected on port 8765, restarting with current version...
    rem Rename this window first so the cleanup below never kills this new window.
    title Tool Collection restarting
    rem Do NOT use /T here: when the restart comes from the web UI this window is a
    rem child of the old node process, so /T would kill us before restarting.
    taskkill /PID %OLD_PID% /F >nul 2>nul
    rem Close the old black window that owns the old node (parent = its cmd.exe).
    powershell -NoProfile -ExecutionPolicy Bypass -Command "$p = Get-CimInstance Win32_Process -Filter ('ProcessId=' + %OLD_PID%) -ErrorAction SilentlyContinue; if ($p) { $q = Get-CimInstance Win32_Process -Filter ('ProcessId=' + $p.ParentProcessId) -ErrorAction SilentlyContinue; if ($q -and $q.Name -eq 'cmd.exe') { Stop-Process -Id $q.ProcessId -Force -ErrorAction SilentlyContinue } }"
    taskkill /FI "WINDOWTITLE eq Tool Collection" /F >nul 2>nul
    rem Wait until the port is really released (max ~10s).
    powershell -NoProfile -Command "for ($i = 0; $i -lt 40; $i++) { if (-not (Get-NetTCPConnection -LocalPort 8765 -State Listen -ErrorAction SilentlyContinue)) { break }; Start-Sleep -Milliseconds 250 }"
    title Tool Collection
    echo [INFO] Old instance stopped. Starting the new one...
    echo.
    set "SKIP_BROWSER=1"
)

rem Open the browser after 2 seconds on a normal start. Skipped when restarting from
rem the web UI (the page is already open and reloads itself). This line must not run
rem in that case: it blocks the batch file when launched via "cmd /c start".
if not defined SKIP_BROWSER (
    start "" /b powershell -NoProfile -Command "Start-Sleep -Seconds 2; Start-Process 'http://127.0.0.1:8765'"
)

node server\main.js

pause
