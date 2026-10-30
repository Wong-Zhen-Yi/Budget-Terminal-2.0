@echo off
echo Dependencies updated: Electron 45.1.0, query caching, MCP and Parquet readers. Virtual tables retain their tested version.
echo Agent recovery: saved run details, temporary read retries, partial answers and Continue research. Manual run limits are configurable in Controls.
echo Scorecard: compare 3-6 companies with saved comparisons, selectable metrics, fiscal-year labels and source details. The current comparison loads at startup.
echo Portfolio and Personal Finance privacy: Obscure replaces numbers with **** while labels, controls and charts stay visible. Reveal restores values and numeric editing.
echo Agent options: MCP refreshes expirations, chains and contract marks. Top-volume research ranks all loaded live expirations and reports missing coverage.
echo Portfolio Dip Finder: Entry shows percentage gain or loss versus your average purchase price.
echo Agent news: MCP news tools refresh sources before returning. Summaries check publication dates and report stale data or refresh failures.
echo Agent reading: highlighting keeps streamed replies steady. Clear the selection to catch up; scroll to the bottom to follow new text.
echo Performance updates: Quant pair calculations and SQLite persistence run in workers. Extra query memory is bounded, prepared startup pages stay available, and large tables render visible rows.
echo Startup dependency fixes: Up/Down price targets preload before page readiness; Cards warms every interval after a partial result; News splits multi-ticker article labels into valid quote requests.
echo Notifications contains the shared Agent inbox and U.S. market-open alerts.
title Budget Terminal
rem Startup recovery: find a supported Node.js or install a verified private runtime.
cd /d "%~dp0" || exit /b 1

echo For live code updates, close the app and use "Launch Budget Terminal Live.cmd" or run npm run dev. Both Windows launch modes select a supported Node.js runtime automatically.
echo Building and verifying the latest desktop-only app. Remote browser access and pairing have been removed. All implemented pages still load at startup; local Agents, MCP tools and backups remain available. The top-bar Ask Agent box opens a full dropdown chat on any page and shows live Thinking, Researching and Done activity. Agents chat can generate, edit and display images inline, plus full-history interactive price charts with in-chat timeframes, zoom and pan. Saved chat charts preload at startup. Charts includes a toggleable 50-day simple moving average. Quant now includes a redesigned research workspace, factor inspector and pairs lab with larger, more readable fonts. IPOs now includes pending filings with dates marked TBD and backup calendar sources.
echo Browser login profiles stay outside source and Git repositories. Cookies and session files are ignored and checked by commit/push hooks, and excluded from app backups.
echo Browser address bar accepts search terms or website URLs. Searches open DuckDuckGo; Agent browser research and search remain available.
echo Browser is included: shared Chromium tabs, navigation, page reading and agent access ON by default for each new window. Browser initializes at startup. Disable and Stop revoke access until you re-enable it. No separate browser install is needed.
echo Startup Yahoo loads are paced at 3 requests per second, without bursts, with up to 3 background requests in flight and a reserved foreground slot. All pages still preload; rate limits trigger automatic backoff. The API USAGE footer shows rolling request counts, active requests and queued work, not a provider quota or loading progress.
echo Temporary data failures retry with backoff. Stuck Yahoo workers restart automatically, and incomplete cached results can recover without waiting for their normal expiry. Startup retry progress and unresolved failures stay visible in Settings.
echo Pre-Market futures now try daily history when hourly refresh fails or returns stale data. Healthy fallbacks clear old degradation; retained stale prices keep their warnings.
echo Trading Volumes now circles the matching dot and shows its ticker label when you hover over a ticker in the volume table.
echo Beta now centers the ticker cluster horizontally using median dollar volume, keeping all outliers visible and the log scale fixed during replay.
echo Settings Page Load Order includes Export for AI to save a local text report of startup order, timings and failures. Nothing is uploaded automatically.
echo News accepts publisher images up to 4 MB within its bounded cache. S^&P500 uses the actual daily holdings freshness. Oil skips expired WTI delivery months and refreshes its strip on expiry rolls.
echo All Agent runs keep the ten-minute and 80-tool-call limit.
echo Security updates installed: Electron 44.9.3 and current compatible dependencies. The shell blocks local-service connections, forms and embedded frames; research tabs restrict direct WebRTC UDP.
echo Agents quick prompts are restored to their original one-line text, with no extra instructions. Selecting one fills the editable composer without sending.
echo News reader includes an AI Summary button beside Open Externally. It summarizes the selected article in Agent chat using your connected model, flags limited previews, and preserves unsent drafts.
echo Data caching now saves remote snapshots incrementally across launches, even while pages poll. Startup restores saved data before warming all pages; fresh data is reused, and only expired or missing data refreshes. Pending cache saves finish before the window closes.
echo MCP research includes summaries, pagination and field selection. Settings adds token-free client setup, data-folder validation, optional website-content approval and request cancellation. Saved-record edits check current revisions.
echo MCP now defaults to read-only, offers local approval for saved-record edits, shows privacy-safe activity in Settings and protects same-session write retries with request IDs.
echo MCP bundles are updated safely with file-lock retries. Persistent locks will show recovery instructions; no MCP clients are forcibly stopped.
echo Bottom status bar stays on one fixed-height line when resizing or updating startup progress. Long messages show their full text on hover; API meters scroll horizontally when needed.
echo Certificate protection requires Node.js 22.23.4+, 24.22.1+, or 26.12.1+. Electron blocks compromised eMudhra keys in both Node and Chromium. TLS verification bypasses are rejected.
echo Startup checks all installed Node.js candidates and installs a checksum-verified private Node.js runtime if needed.
echo The Notifications workspace also offers a U.S. market-open alert at 9:30 AM New York time, skipping weekends and scheduled exchange holidays.
echo Notifications includes Agent alerts, U.S. market-open reminders and test popups. Windows desktop notification registration is refreshed on startup.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\launch-windows.ps1"
if errorlevel 1 goto :failed
exit /b 0

:failed
echo.
echo Budget Terminal could not start. Press any key to close.
pause >nul
exit /b 1
