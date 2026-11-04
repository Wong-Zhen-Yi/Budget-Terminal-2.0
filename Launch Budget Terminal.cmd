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
echo Budget Terminal opens in this terminal. Type BT in PowerShell to launch it directly.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\install-bt.ps1"
if errorlevel 1 goto :failed
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\launch-windows.ps1" -Tui %*
if errorlevel 1 goto :failed
exit /b 0

:failed
echo.
echo Budget Terminal could not start. Press any key to close.
pause >nul
exit /b 1
