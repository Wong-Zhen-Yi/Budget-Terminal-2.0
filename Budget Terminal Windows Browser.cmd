@echo off
title Budget Terminal - Browser
cd /d "%~dp0"

where node >nul 2>nul || goto :missing_node
where npm >nul 2>nul || goto :missing_node

echo Syncing dependencies...
call npm install --no-audit --no-fund
if errorlevel 1 goto :failed

echo Starting Budget Terminal in your browser...
echo Keep this window open while using the app. Press Ctrl+C to stop the server.
call npm run dev:web --workspace budget-terminal-desktop -- --open
if errorlevel 1 goto :failed
exit /b 0

:missing_node
echo Node.js and npm are required. Install Node.js, then run this launcher again.
goto :failed

:failed
echo.
echo Budget Terminal Browser exited with an error. Press any key to close.
pause >nul
exit /b 1
