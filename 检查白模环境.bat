@echo off
chcp 936 >nul
cd /d "%~dp0"
title GG TV 白模环境体检
where node >nul 2>nul
if errorlevel 1 (
    echo [X] 找不到 Node.js，请安装 Node 22 LTS，关窗口重新双击。
    pause
    exit /b 1
)
for /f "delims=" %%v in ('node --version') do set "NODE_CURRENT_VERSION=%%v"
node -e "var v=process.versions.node.split('.');var m=+v[0],n=+v[1];var ok=(m===20&&n>=19)||(m===22&&n>=12)||m>22;if(ok===false||typeof require('node:util').parseEnv!=='function')process.exit(1);" >nul 2>nul
if errorlevel 1 (
    echo [X] 当前 Node.js %NODE_CURRENT_VERSION% 不满足要求，请安装 Node 22 LTS 的 22.12.0 及以上版本。
    pause
    exit /b 1
)
node "scripts\check-mesh.mjs" %*
set "RESULT=%ERRORLEVEL%"
if not "%RESULT%"=="0" echo [X] 白模环境还没齐，请看 docs\安装说明.md 补齐缺项。
pause
exit /b %RESULT%
