@echo off
chcp 936 >nul
cd /d "%~dp0"
title 停止 GG TV

echo.
echo   正在找占用 5290 端口的进程 ...
echo.

set FOUND=
for /f "tokens=5" %%p in ('netstat -ano ^| findstr /c:":5290 " ^| findstr "LISTENING"') do set FOUND=%%p

if not defined FOUND (
    echo   端口 5290 上没有在跑的服务，不用停。
    echo.
    pause
    exit /b 0
)

echo   进程号: %FOUND%
set PNAME=
for /f "tokens=1" %%n in ('tasklist /fi "PID eq %FOUND%" /nh 2^>nul') do set PNAME=%%n
echo   进程名: %PNAME%
echo.

rem 只停本工具：必须是 node，并且启动命令里有 start.mjs。万一 5290 被别的程序占了，不能替用户乱关。
if /i not "%PNAME%"=="node.exe" (
    echo   [!] 这不是 node 进程，不是本工具起的。
    echo       我不会动它 —— 那可能是你别的程序。
    echo.
    pause
    exit /b 1
)
powershell -NoProfile -Command "(Get-CimInstance Win32_Process -Filter 'ProcessId=%FOUND%').CommandLine" 2>nul | findstr /i /c:"start.mjs" >nul
if errorlevel 1 (
    echo   [!] 这个 node 进程不是本工具的小服务（启动命令里没有 start.mjs）。
    echo       我不会动它 —— 那可能是你别的项目。
    echo.
    pause
    exit /b 1
)

taskkill /PID %FOUND% /T /F >nul 2>nul
if errorlevel 1 (
    echo   [X] 停不掉，可能需要管理员权限。
    echo       也可以直接关掉那个黑窗口。
    echo.
    pause
    exit /b 1
)

echo   已停止。
echo.
pause
