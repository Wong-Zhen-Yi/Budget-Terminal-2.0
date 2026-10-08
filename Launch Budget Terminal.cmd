@echo off
title Budget Terminal
cd /d "%~dp0" || exit /b 1

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is required. Install the latest Node.js 24 LTS, then run this launcher again.
  goto :failed
)

node "%~dp0scripts\launch.cjs"
if errorlevel 1 goto :failed
exit /b 0

:failed
echo.
echo Budget Terminal could not start. Press any key to close.
pause >nul
exit /b 1
