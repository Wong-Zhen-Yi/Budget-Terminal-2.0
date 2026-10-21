@echo off
title Budget Terminal
cd /d "%~dp0" || exit /b 1

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is required. Install the latest Node.js 24 LTS, then run this launcher again.
  goto :failed
)

echo Building and verifying the latest desktop-only app. Remote browser access and pairing have been removed. All implemented pages still load at startup; local Agents, MCP tools and backups remain available. The top-bar Ask Agent box opens a full dropdown chat on any page and shows live Thinking, Researching and Done activity. Agents chat can generate, edit and display images inline, plus full-history interactive price charts with in-chat timeframes, zoom and pan. Saved chat charts preload at startup. Charts includes a toggleable 50-day simple moving average. Quant now includes a redesigned research workspace, factor inspector and pairs lab with larger, more readable fonts. IPOs now includes pending filings with dates marked TBD and backup calendar sources.
echo Browser login profiles stay outside source and Git repositories. Cookies and session files are ignored and checked by commit/push hooks, and excluded from app backups.
echo Browser address bar accepts search terms or website URLs. Searches open DuckDuckGo; Agent browser research and search remain available. Only the portfolio quick prompts instruct Agents not to use the browser.
echo Browser is included: shared Chromium tabs, navigation, page reading and agent access ON by default for each new window. Browser initializes at startup. Disable and Stop revoke access until you re-enable it. No separate browser install is needed.
echo Startup Yahoo loads are paced at 1 request per second, without bursts, with up to 2 background requests in flight. All pages still preload; foreground requests take priority and rate limits trigger further slowdown.
echo Temporary data failures retry with backoff. Stuck Yahoo workers restart automatically, and incomplete cached results can recover without waiting for their normal expiry. Startup retry progress and unresolved failures stay visible in Settings.
echo All Agent runs keep the ten-minute and 80-tool-call limit. Short portfolio quick prompts request at most six built-in tool calls, no browser or retries, and answers under 150 words, aiming to finish within two minutes.
echo Agents quick prompts cover up to five holdings and return partial results when data is missing. Prompts stay editable; selecting one never starts research.
echo News reader includes an AI Summary button beside Open Externally. It summarizes the selected article in Agent chat using your connected model, flags limited previews, and preserves unsent drafts.
echo Data caching now saves remote snapshots incrementally across launches, even while pages poll. Startup restores saved data before warming all pages; fresh data is reused, and only expired or missing data refreshes. Pending cache saves finish before the window closes.
echo MCP bundles are updated safely with file-lock retries. Persistent locks will show recovery instructions; no MCP clients are forcibly stopped.
node "%~dp0scripts\launch.cjs"
if errorlevel 1 goto :failed
exit /b 0

:failed
echo.
echo Budget Terminal could not start. Press any key to close.
pause >nul
exit /b 1
