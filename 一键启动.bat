@echo off
chcp 936 >nul
cd /d "%~dp0"
title GG TV

echo.
echo   ============================================
echo     GG TV
echo   ============================================
echo.
echo   [1/4] 检查 Node.js ...
where node >nul 2>nul
if errorlevel 1 (
    echo.
    echo   [X] 找不到 Node.js
    echo.
    echo   这个工具要靠它才能跑。去 https://nodejs.org 装一个，
    echo   装完把这个窗口关掉重新双击。
    echo.
    pause
    exit /b 1
)
rem NODE_VERSION_CHECK_BEGIN
for /f "delims=" %%v in ('node --version') do set "NODE_CURRENT_VERSION=%%v"
node -e "var v=process.versions.node.split('.');var m=+v[0],n=+v[1];var ok=(m===20&&n>=19)||(m===22&&n>=12)||m>22;if(ok===false||typeof require('node:util').parseEnv!=='function')process.exit(1);" >nul 2>nul
if errorlevel 1 (
    echo.
    echo   [X] 当前 Node.js %NODE_CURRENT_VERSION% 不满足本工具要求
    echo   请安装 20.19.0 及以上的 20.x，或 22.12.0 及以上版本。
    echo   装好后关闭这个窗口，重新双击启动。
    echo.
    pause
    exit /b 1
)
echo       Node.js %NODE_CURRENT_VERSION%  OK
rem NODE_VERSION_CHECK_END

echo   [2/4] 检查依赖 ...
rem RELEASE_CHECK_BEGIN
set "BUILD_PAGE="
if exist "node_modules\.bin\vite.cmd" set "BUILD_PAGE=1"
if not defined BUILD_PAGE if not exist "dist\index.html" (
    echo.
    echo   [X] 这里没有打包好的页面，也没有装依赖
    echo.
    echo   如果你是在 GitHub 上点「Code - Download ZIP」下的，那是源码包。
    echo   普通使用请到发版页面下载整合包 ggtv-canvas-版本号-win.zip：
    echo       https://github.com/c2247189334/ggtv-canvas/releases
    echo   完整解压后，双击整合包里的 一键启动.bat。
    echo.
    echo   开发者：我不会自动装依赖，请在这个文件夹里手动跑一次：
    echo       npm ci
    echo.
    pause
    exit /b 1
)
if defined BUILD_PAGE echo       依赖齐全  OK
if not defined BUILD_PAGE echo       整合包：页面已打包好
rem RELEASE_CHECK_END

rem MEDIA_CHECK_BEGIN
for %%t in (ffmpeg ffprobe) do (
    where %%t >nul 2>nul
    if errorlevel 1 (
        echo.
        echo   [X] 找不到 %%t，视频处理需要 ffmpeg 和 ffprobe。
        echo   请手动安装：winget install Gyan.FFmpeg
        echo   装完关闭这个窗口，再重新双击 一键启动.bat。
        echo.
        pause
        exit /b 1
    )
)
rem MEDIA_CHECK_END

echo   [3/4] 检查端口 5290 ...
set PORT_PID=
for /f "tokens=5" %%p in ('netstat -ano ^| findstr /c:":5290 " ^| findstr "LISTENING"') do set PORT_PID=%%p
if defined PORT_PID (
    echo.
    echo   [!] 端口 5290 已经被占用了，占用它的进程号是 %PORT_PID%
    echo.
    for /f "tokens=1" %%n in ('tasklist /fi "PID eq %PORT_PID%" /nh 2^>nul') do echo       进程名: %%n
    echo.
    echo   如果那是上一次没关干净的本工具，先双击「停止.bat」再来。
    echo   如果是别的程序，别乱关，先看看是什么。
    echo.
    pause
    exit /b 1
)
echo       端口空着  OK

echo   [4/4] 打包页面 ...
if not defined BUILD_PAGE goto build_done
set BUILD_LOG=%TEMP%\infinite-canvas-build.log
call "node_modules\.bin\vite.cmd" build >"%BUILD_LOG%" 2>&1
if errorlevel 1 (
    echo.
    echo   [X] 打包失败，原始报错如下：
    echo.
    type "%BUILD_LOG%"
    del "%BUILD_LOG%" >nul 2>nul
    echo.
    pause
    exit /b 1
)
del "%BUILD_LOG%" >nul 2>nul
echo       打包完成  OK
:build_done

echo.
echo   ============================================
echo.
echo     浏览器会自动打开。如果没弹出来，手动访问：
echo.
echo         http://127.0.0.1:5290
echo.
echo     只在这台电脑上能打开（只绑 127.0.0.1）。
echo     ** 关掉这个黑窗口 = 停止服务 **
echo.
echo   ============================================
echo.

start "" "http://127.0.0.1:5290"
node "server\start.mjs"

echo.
echo   服务已经停了。
echo.
pause
