@echo off
rem Convex snapshot writes are restored; record-era cloud tables are retained as an archive.
rem Database sync restored to 3208321: optional Convex snapshots, GitHub sign-in and complete-copy conflict choices.
rem macOS: double-click Launch Budget Terminal.command. Linux: Launch Budget Terminal.sh.
rem Backup and sync snapshots resolve asynchronous defaults inside function bodies for build compatibility.
rem Backup imports recover on failure; Escape cancels edits; public WebSocket resources are supported.
rem Shared option chains, single-capture backups, targeted refresh and live status updates. Measurements: docs/efficiency-results.md.
rem Settings > Controller controls: game-style diagram, live input display and navigation-safe test mode.
rem Controller page switching follows visible workspace/page order, including custom ordering and hidden pages.
rem Compact layouts keep Treasury curves, market controls, probability statistics and heatmap details accessible.
rem Personal Finance charts keep readable values while Totals and Goal resize to the screen.
rem Obscure hides recurring bill names and amounts; Reveal restores editable names.
rem Personal Finance: Steam Deck layout keeps recurring bill names readable and the Goal panel visible.
rem Controller support: D-pad/left stick focus, A activate, B dismiss, shoulders switch pages, Menu page picker, right stick scroll.
rem Display compatibility: centered work-area bounds, compact minimum size and safe monitor changes; Steam Deck Gaming Mode uses native fullscreen.
rem Charts watchlists are saved with user data, backups and cloud sync; existing lists migrate automatically.
rem GitHub sync sign-in checks backend credentials first and shows setup guidance instead of a GitHub 404.
rem Convex sync supports GitHub browser sign-in and regional cloud deployments; local data works without signing in.
rem Desktop launches run independently so this console can close after startup.
rem Optional Convex sync: local saves work without a connection; sign-in and conflict controls are in Settings.
rem AllTick API removed from Settings and supported credential providers.
rem Crypto opens directly with market data; the Workspace header, USD badge and Copy snapshot action are removed.
rem Portfolio stocks highlight the full row on hover and while editing or focusing row controls.
rem Double-click opens the desktop app directly; btd remains available in the terminal.
rem Settings: compact sizing, horizontal categories, no redundant Preferences label, All settings page or introductory header.
rem GitHub showcase refreshed: README.md includes eight demo screenshots across markets, research, charts, portfolios, and learning.
rem Current dark navy and blue colour scheme is locked in AGENTS.md; palette changes require an explicit user request.
title Budget Terminal
rem YouTube PiP opens a movable, resizable always-on-top window outside Budget Terminal; pop-out and return preserve playback.
cd /d "%~dp0" || exit /b 1
echo Opening Budget Terminal...
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\launch-windows.ps1"
if errorlevel 1 goto :launchFailed
exit /b 0

:launchFailed
echo.
echo Budget Terminal could not open. Check the error above. Press any key to close.
pause >nul
exit /b 1
