@echo off
rem Crypto opens directly with market data; the Workspace header, USD badge and Copy snapshot action are removed.
rem Portfolio stocks highlight the full row on hover and while editing or focusing row controls.
rem BT TUI includes Portfolio, candlestick charts and Agents chat with saved history and model controls.
rem Settings: compact sizing, horizontal categories, no redundant Preferences label, All settings page or introductory header.
rem GitHub showcase refreshed: README.md includes eight demo screenshots across markets, research, charts, portfolios, and learning.
rem Current dark navy and blue colour scheme is locked in AGENTS.md; palette changes require an explicit user request.
title Budget Terminal - Install, Check and Open
rem YouTube PiP opens a movable, resizable always-on-top window outside Budget Terminal; pop-out and return preserve playback.
cd /d "%~dp0" || exit /b 1
echo Budget Terminal installer and checker
echo Checking Node.js, dependencies, Electron, application builds and terminal commands...
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\launch-windows.ps1" -Setup
if errorlevel 1 goto :failed
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\launch-menu.ps1"
if errorlevel 1 goto :launchFailed
exit /b 0

:launchFailed
echo.
echo Budget Terminal could not open. Check the error above. Press any key to close.
pause >nul
exit /b 1

:failed
echo.
echo Budget Terminal setup failed. Fix the error above, then double-click this file to retry.
echo Press any key to close.
pause >nul
exit /b 1
