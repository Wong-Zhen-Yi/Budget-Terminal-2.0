@echo off
title Budget Terminal
cd /d "%~dp0" || exit /b 1

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is required. Install the latest Node.js 24 LTS, then run this launcher again.
  goto :failed
)

echo Building and verifying the latest desktop-only app. Remote browser access and pairing have been removed. All implemented pages still load at startup; local Agents, MCP tools and backups remain available. The top-bar Ask Agent box opens a full dropdown chat on any page and shows live Thinking, Researching and Done activity. Agents chat can generate, edit and display images inline, plus full-history interactive price charts with in-chat timeframes, zoom and pan. Saved chat charts preload at startup. Charts includes a toggleable 50-day simple moving average. Quant now includes a redesigned research workspace, factor inspector and pairs lab with larger, more readable fonts. IPOs now includes pending filings with dates marked TBD and backup calendar sources.
echo MCP bundles are updated safely with file-lock retries. Persistent locks will show recovery instructions; no MCP clients are forcibly stopped.
node "%~dp0scripts\launch.cjs"
if errorlevel 1 goto :failed
exit /b 0

:failed
echo.
echo Budget Terminal could not start. Press any key to close.
pause >nul
exit /b 1
