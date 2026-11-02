@echo off
echo TV: separate market video page with recent channel uploads, newest-first coverage and five-minute refresh. Feed and images preload at startup.
echo Dictionary Reading Room: category browsing, readable articles, section navigation, saved terms, recent history and formula copying. All 405 terms remain available offline. Dictionary candlestick charts render at full size across all pattern examples.
echo YouTube Research Terminal: compact table, right-side inspector and pagination without scrollbars. Warning-count status and warning controls are removed. All videos and images still preload at startup.
echo Crypto: removed the snapshot summary banner. Refresh errors, rate limits and startup loading remain visible.
echo Agents fix: Windows detects both current and older Codex npm executable layouts at startup and reconnect.
echo Telegram: the connection button sits beside Trackers in the Agents toolbar; startup checks private chat access; delivery errors stay visible and identify chat, token, blocked-bot or gateway problems. Agents offers Check private chat without sending a message.
echo Saved-data warning banners removed throughout the app, including ETF, IPO, Valuation, company pages and charts. Startup progress and failure details remain in Settings.
echo Branding: Fold logo is active in the title bar, app icon and launcher shortcuts.
echo MCP startup fix: desktop-only cache controls, heatmap progress and TV are classified correctly. Agent startup errors no longer block the app from opening.
echo Cache startup: saved pages stay usable during background refresh. Settings controls 256 MiB page snapshots, 2 GiB market data, a separate 512 MiB image budget and 30-day retention. All pages still preload.
echo Heatmap fills holdings and quote colours progressively while data loads; loading progress stays visible until completion.
echo Refresh schedule: Heatmap every 30 minutes; company snapshots and Personal Finance FX hourly; Dashboard headlines every 5 minutes. Backtest preloads once with no automatic refresh.
echo Crypto Workspace: interactive perpetual charts, watchlist selection, searchable markets, source labels and enforced CoinGecko cooldowns. The chart preloads with every page.
echo Startup loading: completed pages refresh while slower pages load, recovered warnings clear, and changed selections preload without restarting unrelated pages.
echo Page headers: removed the equity price source subtitle from every page.
echo Agents connects quietly at startup; connection status and errors stay visible in the Agents toolbar.
echo Agents chat: the message composer fills resizable dashboard and dropdown panes at every zoom level.
echo Data health: all startup pages report current results and refresh after expiry. Chart history keeps its own freshness; SPY security IDs and Robinhood monthly reports are handled correctly.
echo MCP prices use the shared live Hyperliquid feed for mapped stocks. Fast quote reads skip macro and sector lookups by default; projected responses preserve perp market labels and Yahoo fallback details.
echo Portfolio charts stay prepared across all books: Dashboard, Stocks and selected Main/Multi views load at startup, refresh in the background and prepare new holdings automatically. The bottom status strip is hidden; background loading, chart refresh and monitoring continue. Readiness and failures remain available in Settings.
echo Chart ticker switches reuse cached history and refresh its recent tail. Interactive requests have priority and reserved Hyperliquid rate budget; live marks keep chart zoom steady.
echo Portfolio Move Position: select stocks and a destination, then confirm. Shares, average prices and weight settings are preserved; existing destination tickers are protected.
echo Settings API Usage Dashboard shows live provider requests and searchable page-by-page API purposes.
echo Portfolio stock removal: use Remove Position to select named tickers and review them before confirming. Distant row X buttons have been removed.
echo Stock prices use labelled Hyperliquid equity-perpetual marks where mapped, including portfolio values and screener prices. Prices and covered charts stream live with native UTC 4-hour perp bars; Yahoo supplies stock-history and quote fallbacks plus fundamentals.
echo Crypto includes Hyperliquid perpetual markets: mark prices, hourly funding, open interest and volume. Free public data loads at startup and refreshes every 60 seconds while Crypto is visible.
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
echo Settings API usage now shows startup health and a compact live provider table, with an expandable API and page directory. Failed and incomplete pages appear first in its startup status list.
echo Yahoo load reduction: mapped crypto-equity prices skip Yahoo charts, stock metadata is cached for 15 minutes, and crypto perpetuals share the live equity socket with REST fallback. All pages still preload.
echo Stock data reuse: checked Yahoo U.S. closing quotes and history stay cached until the next regular session, after closing updates settle. Manual refresh and live perpetual feeds continue. All pages still preload.
title Budget Terminal
rem Startup recovery: find a supported Node.js or install a verified private runtime.
cd /d "%~dp0" || exit /b 1

echo For live code updates, close the app and use "Launch Budget Terminal Live.cmd" or run npm run dev. Both Windows launch modes select a supported Node.js runtime automatically.
echo Building and verifying the latest desktop-only app. Remote browser access and pairing have been removed. All implemented pages still load at startup; local Agents, MCP tools and backups remain available. The top-bar Ask Agent box opens a full dropdown chat on any page and shows live Thinking, Researching and Done activity. Agents chat can generate, edit and display images inline, plus full-history interactive price charts with in-chat timeframes, zoom and pan. Saved chat charts preload at startup. Charts includes a toggleable 50-day simple moving average. Quant now includes a redesigned research workspace, factor inspector and pairs lab with larger, more readable fonts. IPOs now includes pending filings with dates marked TBD and backup calendar sources.
echo Browser login profiles stay outside source and Git repositories. Cookies and session files are ignored and checked by commit/push hooks, and excluded from app backups.
echo Browser address bar accepts search terms or website URLs. Searches open DuckDuckGo; Agent browser research and search remain available.
echo Browser is included: shared Chromium tabs, navigation, page reading and agent access ON by default for each new window. Browser initializes at startup. Disable and Stop revoke access until you re-enable it. No separate browser install is needed.
echo Startup Yahoo loads are paced at 3 requests per second, without bursts, with up to 3 background requests in flight and a reserved foreground slot. All pages still preload; rate limits trigger automatic backoff. Settings API Usage shows rolling request counts, active requests and queued work, not a provider quota or loading progress.
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
echo Bottom status strip is hidden. All pages still preload, portfolio charts refresh and API monitoring continues in the background; diagnostics are available in Settings.
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
