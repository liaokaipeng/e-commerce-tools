@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Shopee Bidding Export Tool

where node >nul 2>nul
if errorlevel 1 (
    echo [ERROR] Node.js not found. Please install Node.js first.
    pause
    exit /b 1
)

if not exist node_modules\exceljs (
    echo [INFO] First run: installing dependencies...
    call npm install
    if errorlevel 1 (
        echo [ERROR] npm install failed. Please check network.
        pause
        exit /b 1
    )
)

echo [INFO] Starting server, opening browser...
start "" http://127.0.0.1:8765
node main.js
pause