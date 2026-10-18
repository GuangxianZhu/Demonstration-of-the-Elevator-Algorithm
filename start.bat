@echo off
chcp 65001 >nul
cd /d "%~dp0"
rem 纯静态页面，不需要服务器，直接用默认浏览器打开
if not exist "index.html" (
  echo 找不到 index.html，请确认本文件和 index.html 在同一个文件夹里。
  pause
  exit /b 1
)
echo 正在用默认浏览器打开电梯算法演示...
start "" "%~dp0index.html"
