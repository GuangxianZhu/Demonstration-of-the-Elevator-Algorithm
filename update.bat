@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

where git >nul 2>nul
if errorlevel 1 (
  echo 没有找到 git，请先安装：https://git-scm.com/download/win
  goto :end
)

git rev-parse --is-inside-work-tree >nul 2>nul
if errorlevel 1 (
  echo 当前文件夹不是 git 仓库。请用 git clone 下载本项目后再运行此脚本。
  goto :end
)

for /f "delims=" %%b in ('git rev-parse --abbrev-ref HEAD') do set "BRANCH=%%b"
if /i not "%BRANCH%"=="main" (
  echo 当前在分支 %BRANCH%，不是 main。
  choice /m "要切换到 main 再更新吗"
  if errorlevel 2 goto :end
  git checkout main
  if errorlevel 1 (
    echo 切换失败，可能有未提交的修改。请先处理后再试。
    goto :end
  )
)

echo 正在检查 main 分支的更新...
git fetch origin main
if errorlevel 1 (
  echo 获取远程更新失败，请检查网络。
  goto :end
)

for /f %%n in ('git rev-list --count HEAD..origin/main') do set "BEHIND=%%n"
if "%BEHIND%"=="0" (
  echo 已经是最新版本，无需更新。
  goto :end
)

echo 发现 %BEHIND% 个新提交，正在更新...
git pull --ff-only origin main
if errorlevel 1 (
  echo 更新失败：本地可能有改动和远程冲突。可以先备份修改，再运行 git stash 后重试。
  goto :end
)
echo 更新完成！

:end
echo.
pause
