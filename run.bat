@echo off
title StreamMoon Frontend - LOCAL
setlocal

REM ============================================================
REM  RUN.BAT - starts the FRONTEND only:
REM  1) Points the desktop app to http://127.0.0.1:3000
REM     (cloud settings saved once to config.json.backup-cloud)
REM  2) Builds: npm run compile (bytecode) + encrypt.js (assets)
REM  3) Starts the desktop app (npm start)
REM  NOTE: the backend must be running (backend\START.BAT)
REM ============================================================

echo.
echo ============================================
echo   StreamMoon Frontend - LOCAL Mode
echo ============================================
echo.

cd /d "%~dp0"

REM ---- 1) Point the desktop app to the local backend ----
node -e "const fs=require('fs'),path=require('path');const p=path.join(process.env.APPDATA,'StreamMoon','SteamMoon','config.json');if(fs.existsSync(p)==false){console.log('[WARN] Config not found - app will use default URL');process.exit(0)}const d=JSON.parse(fs.readFileSync(p,'utf8'));if(fs.existsSync(p+'.backup-cloud')==false){fs.writeFileSync(p+'.backup-cloud',JSON.stringify(d,null,2));console.log('[OK] Cloud settings saved to config.json.backup-cloud')}else{console.log('[OK] Cloud backup already exists - kept as is')}delete d.serverUrlSealed;d.serverUrl='http://127.0.0.1:3000';fs.writeFileSync(p,JSON.stringify(d,null,2));console.log('[OK] Desktop app pointed to http://127.0.0.1:3000')"
if errorlevel 1 (
    echo [X] Node not found or config error.
    pause
    exit /b 1
)

REM ---- 2) Build: bytecode compile + assets encryption ----
echo [..] Compiling bytecode from current source...
call npx electron scripts/compile.js
if errorlevel 1 (
    echo [WARN] compile failed - the app will use the existing bytecode.
) else (
    echo [OK] Bytecode compiled from current source.
)
echo [..] Encrypting UI assets...
call node scripts/encrypt.js
if errorlevel 1 (
    echo [WARN] encrypt failed - the app will use the existing enc/ assets.
) else (
    echo [OK] UI assets encrypted to enc/
)

REM ---- 3) Start the desktop app ----
echo [..] Starting desktop app: npm start
call npm start
