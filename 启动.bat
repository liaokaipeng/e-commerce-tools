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
    rem Validate the listener AND remember the cmd.exe that owns the old black window.
    rem This must happen BEFORE taskkill: a dead PID can no longer tell us its parent.
    rem -1 = listener is not this project's node server; 0 = ours but no owning cmd window.
    set "OLD_CMD_PID="
    for /f "tokens=1" %%C in ('powershell -NoProfile -ExecutionPolicy Bypass -Command "$p = Get-CimInstance Win32_Process -Filter ('ProcessId=' + %OLD_PID%) -ErrorAction SilentlyContinue; if ($p -and $p.Name -eq 'node.exe' -and $p.CommandLine -match 'server[\\/]main\.js') { $q = Get-CimInstance Win32_Process -Filter ('ProcessId=' + $p.ParentProcessId) -ErrorAction SilentlyContinue; if ($q -and $q.Name -eq 'cmd.exe' -and $q.CommandLine -match '/[ck]\s+.+\.bat') { $q.ProcessId } else { 0 } } else { -1 }"') do set "OLD_CMD_PID=%%C"
    if "!OLD_CMD_PID!"=="-1" (
        rem Port belongs to another program: never kill it, just open the browser.
        echo [INFO] Port 8765 is used by another program.
        echo        Opening browser...
        start "" "http://127.0.0.1:8765"
        pause
        exit /b 0
    )
    if not defined OLD_CMD_PID (
        rem Verification did not run (PowerShell failed): never kill an unverified process.
        echo [WARN] Could not verify the process on port 8765, refusing to kill it.
        echo        Opening browser...
        start "" "http://127.0.0.1:8765"
        pause
        exit /b 0
    )
    echo [INFO] Old instance detected on port 8765, restarting with current version...
    rem Rename this window first so the cleanup below never kills this new window.
    title Tool Collection restarting
    rem Decide BEFORE killing node: once node dies the old window may already consume the
    rem restart marker, so checking afterwards would be a race.
    set "WEB_RESTART="
    if exist "server\data\.restart-requested" set "WEB_RESTART=1"
    rem Do NOT use /T here: when the restart comes from the web UI this window is a
    rem child of the old node process, so /T would kill us before restarting.
    taskkill /PID %OLD_PID% /F >nul 2>nul
    rem Close the old black window/tab by the owner pid captured above. Never by window
    rem title: on Windows 11 the window belongs to WindowsTerminal.exe, so a title match
    rem could kill the whole terminal (including this new tab and unrelated user tabs).
    rem When a restart marker exists (web-triggered), let the old window consume it and
    rem exit cleanly by itself: that is the only way Windows Terminal closes the old tab.
    if not defined WEB_RESTART if defined OLD_CMD_PID if not "!OLD_CMD_PID!"=="0" taskkill /PID !OLD_CMD_PID! /F >nul 2>nul
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

rem The server writes this marker right before requesting an auto-restart. Consume it and
rem exit with code 0 instead of pausing, so Windows Terminal really closes this old tab
rem (default closeOnExit=graceful only closes on a clean exit).
rem
rem A window opened just to run this batch (Explorer double-click or the web restart)
rem runs as `cmd /c|/k <bat>`. With /K (older restart.js used `start "" <bat>`),
rem `exit /b 0` only returns to the prompt and keeps the window: a bare `exit` closes it.
rem Detect that case by the command line ending in .bat, so an interactive shell where
rem the user typed 启动.bat is never closed.
set "CC=%CMDCMDLINE%"
set CC=%CC:"=%
set "BAT_LAUNCH="
if /i "%CC:~-4%"==".bat" set "BAT_LAUNCH=1"
if exist "server\data\.restart-requested" (
    del "server\data\.restart-requested" >nul 2>nul
    echo [INFO] Restart completed, closing this window.
    if defined BAT_LAUNCH exit
    exit /b 0
)

pause
