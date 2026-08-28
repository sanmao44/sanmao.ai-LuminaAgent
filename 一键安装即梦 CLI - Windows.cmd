@echo off
setlocal
cd /d "%~dp0"
echo ========================================
echo       SANMAO.AI 一键安装即梦 CLI
echo ========================================
echo.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\install-jimeng.ps1"
set "exitCode=%ERRORLEVEL%"
echo.
if "%exitCode%"=="0" (
  echo 安装成功。请回到 SANMAO.AI 设置页点击“重新检测”。
) else (
  echo 安装未完成，请根据上方提示处理后重试。
)
echo.
pause
exit /b %exitCode%
