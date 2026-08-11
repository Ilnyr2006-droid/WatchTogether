@echo off
setlocal
title WatchTogether
cd /d "%~dp0"

powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\windows-launch.ps1"
set "WATCHTOGETHER_EXIT=%ERRORLEVEL%"

if not "%WATCHTOGETHER_EXIT%"=="0" (
  echo.
  echo WatchTogether could not start. Keep this window open and send a screenshot of the error.
  pause
)

exit /b %WATCHTOGETHER_EXIT%
