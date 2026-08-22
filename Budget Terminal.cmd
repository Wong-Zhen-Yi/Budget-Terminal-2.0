@echo off
title Budget Terminal
cd /d "%~dp0"

if not exist "node_modules" (
  echo Installing dependencies, this only happens once...
  call npm install || goto :failed
)

echo Starting Budget Terminal...
call npm run dev
if errorlevel 1 goto :failed
exit /b 0

:failed
echo.
echo Budget Terminal exited with an error. Press any key to close.
pause >nul
exit /b 1
