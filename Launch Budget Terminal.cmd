@echo off
title Budget Terminal
cd /d "%~dp0" || exit /b 1

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is required. Install the latest Node.js 24 LTS, then run this launcher again.
  goto :failed
)

echo Building and verifying the latest app files, including Dashboard 2.0 as the default opening page with a portfolio pie, Agents with private local chat history, notifications, Codex-written trackers, automatic Codex connection, New chat without disconnecting, native pie charts and portfolio briefing prompts, a portfolio heatmap on the right, repaired HOOD report loading, expanded heatmap sector classification with cached lookups and visible coverage, and the rebuilt cache-first ETF Explorer with a searchable directory and persistent holdings snapshots, plus the responsive calendar with CPI/PPI/PCE readings and larger, easier-to-read calendar and day-hover text, and Current P/E and Forward P/E columns before the colour-coded PEG ratios in the Portfolio stock table with green at 1.0, red above 1.0 and brighter green below 1.0...
node "%~dp0scripts\launch.cjs"
if errorlevel 1 goto :failed
exit /b 0

:failed
echo.
echo Budget Terminal could not start. Press any key to close.
pause >nul
exit /b 1
