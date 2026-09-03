@echo off
title Budget Terminal
cd /d "%~dp0"

echo Syncing dependencies...
call npm install --no-audit --no-fund
if errorlevel 1 (
  if not exist "node_modules" goto :failed
  echo WARNING: npm install failed; starting with the existing node_modules.
)

echo Checking Electron runtime...
call npm run ensure:electron || goto :failed

echo Starting Budget Terminal...
call npm run dev
if errorlevel 1 goto :failed
exit /b 0

:failed
echo.
echo Budget Terminal exited with an error. Press any key to close.
pause >nul
exit /b 1
