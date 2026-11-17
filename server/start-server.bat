@echo off
chcp 65001 >nul
cd /d %~dp0
title 校园宿舍线上报修 APP - 后端服务

where node >nul 2>nul
if errorlevel 1 (
  echo [错误] 未检测到 Node.js，请先安装 Node.js 后重试：https://nodejs.org
  pause
  exit /b 1
)

echo 正在启动后端服务，端口 3000，关闭此窗口即停止服务...
echo.
node server.js
pause
