@echo off
rem GitHub showcase refreshed: README.md includes eight demo screenshots across markets, research, charts, portfolios, and learning.
rem Current dark navy and blue colour scheme is locked in AGENTS.md; palette changes require an explicit user request.
echo Public API routing: Coinbase and Binance spot quotes, shared CoinGecko metadata, World Bank and IMF annual context. Key-based APIs remain inactive.
echo MCP: public Polymarket reads registered; all implemented pages support screenshot access.
echo AllTick, Finnhub and Financial Modeling Prep: encrypted API key settings added; providers remain inactive.
echo Polymarket: redesigned market cards, probability charts, depth and activity; public datasets and startup preloading retained.
echo Diagnostic logs: open Settings - Diagnostics in the desktop app, or press Ctrl+Shift+L.
title Budget Terminal
cd /d "%~dp0" || exit /b 1
echo Checking the optional BT command for PowerShell...
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\install-bt.ps1"
if errorlevel 1 echo BT setup failed. Run npm run setup:tui to retry. Continuing to the desktop app.
echo Opening the Budget Terminal desktop app. Keep this launcher window open while using the app.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\launch-windows.ps1" %*
if errorlevel 1 goto :failed
exit /b 0

:failed
echo.
echo Budget Terminal could not start. Press any key to close.
pause >nul
exit /b 1
