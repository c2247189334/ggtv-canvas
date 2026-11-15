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
rem 不看 netstat 的 LISTENING：有的 Windows 更新后它会把正在监听的端口显示成别的状态，
rem 还会把已经退出的程序留下的残影显示成"进程号 0 在监听"。直接试着占一下端口，占得上就是空的。
node -e "var s=require('net').createServer();s.once('error',function(){process.exit(1)});s.listen(5290,'127.0.0.1',function(){s.close(function(){process.exit(0)})})" >nul 2>nul
if not errorlevel 1 goto port_free
set PORT_PID=
for /f "delims=" %%p in ('powershell -NoProfile -Command "(Get-NetTCPConnection -LocalPort 5290 -ErrorAction SilentlyContinue | Where-Object { $_.RemotePort -eq 0 -and $_.OwningProcess -ne 0 } | Select-Object -First 1).OwningProcess" 2^>nul') do set PORT_PID=%%p
echo.
echo   [!] 端口 5290 已经被占用了
if defined PORT_PID (
    echo       占用它的进程号是 %PORT_PID%
    for /f "tokens=1" %%n in ('tasklist /fi "PID eq %PORT_PID%" /nh 2^>nul') do echo       进程名: %%n
)
if not defined PORT_PID echo       查不到是哪个程序占的。等一分钟再双击试试，还不行就重启电脑。
echo.
echo   如果那是上一次没关干净的本工具，先双击「停止.bat」再来。
echo   如果是别的程序，别乱关，先看看是什么。
echo.
pause
exit /b 1
:port_free
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
