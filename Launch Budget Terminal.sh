#!/bin/sh
echo "Hyperliquid: live crypto candles share the equity connection, including overnight updates and reconnect recovery; market tables retain 24h change and volume."
echo 'Reload (F5) updates the current page first, then checks all other pages. Page refresh buttons have been removed; startup still loads every page.'
echo "Pages populate completed sections while remaining data loads; all pages still preload and startup failures remain visible."
echo "Page Loading Status banner removed. Startup progress, failures and diagnostics remain in Settings; page readiness indicators remain available. Opening a page promotes its queued requests with fair background turns. Shared reads avoid duplicate work. Readers retain controls longer and evicted pages restore scroll. All pages still preload."
echo "TV: separate market video page with recent channel uploads, newest-first coverage and five-minute refresh. Feed and images preload at startup."
echo "Dictionary Reading Room: category browsing, readable articles, section navigation, saved terms, recent history and formula copying. All 405 terms remain available offline. Dictionary candlestick charts render at full size across all pattern examples."
echo "YouTube Research Terminal: compact table, right-side inspector and pagination without scrollbars. Warning-count status and warning controls are removed. All videos and images still preload at startup."
echo "Crypto: removed the snapshot summary banner. Refresh errors, rate limits and startup loading remain visible."
echo "Agents fix: Windows detects both current and older Codex npm executable layouts at startup and reconnect."
echo "Telegram: the connection button sits beside Trackers in the Agents toolbar; startup checks private chat access; delivery errors stay visible and identify chat, token, blocked-bot or gateway problems. Agents offers Check private chat without sending a message."
echo "Saved-data warning banners removed throughout the app, including ETF, IPO, Valuation, company pages and charts. Startup progress and failure details are available in Settings."
echo "Branding: Fold logo is active in the title bar, app icon and launcher shortcuts."
echo "MCP startup fix: desktop-only cache controls, heatmap progress and TV are classified correctly. Agent startup errors no longer block the app from opening."
echo "Cache startup: saved pages stay usable during background refresh. Settings controls 256 MiB page snapshots, 2 GiB market data, a separate 512 MiB image budget and 30-day retention. All pages still preload."
echo "Heatmap fills holdings and quote colours progressively while data loads; loading progress stays visible until completion."
echo "Refresh schedule: Heatmap every 30 minutes; company snapshots and Personal Finance FX hourly; Dashboard headlines every 5 minutes. Backtest preloads once with no automatic refresh."
echo "Crypto Workspace: interactive perpetual charts, watchlist selection, searchable markets, source labels and enforced CoinGecko cooldowns. The chart preloads with every page."
echo "Startup loading: completed pages refresh while slower pages load, recovered warnings clear, and changed selections preload without restarting unrelated pages."
echo "Page headers: removed the equity price source subtitle from every page."
echo "Agents connects quietly at startup; connection status and errors stay visible in the Agents toolbar."
echo "Yahoo load reduction: mapped crypto-equity prices skip Yahoo charts, stock metadata is cached for 15 minutes, and crypto perpetuals share the live equity socket with REST fallback. All pages still preload."
echo "Stock data reuse: checked Yahoo U.S. closing quotes and history stay cached until the next regular session, after closing updates settle. Manual refresh and live perpetual feeds continue. All pages still preload."
echo "Agents chat: the message composer fills resizable dashboard and dropdown panes at every zoom level."
echo "Data health: all startup pages report current results and refresh after expiry. Chart history keeps its own freshness; SPY security IDs and Robinhood monthly reports are handled correctly."
echo "MCP prices use the shared live Hyperliquid feed for mapped stocks. Fast quote reads skip macro and sector lookups by default; projected responses preserve perp market labels and Yahoo fallback details."
echo "Portfolio charts stay prepared across all books: Dashboard, Stocks and selected Main/Multi views load at startup, refresh in the background and prepare new holdings automatically. The bottom status strip is hidden; background loading, chart refresh and monitoring continue. Readiness and failures are available in Settings."
echo "Chart ticker switches reuse cached history and refresh its recent tail. Interactive requests have priority and reserved Hyperliquid rate budget; live marks keep chart zoom steady."
echo "Portfolio Move Position: select stocks and a destination, then confirm. Shares, average prices and weight settings are preserved; existing destination tickers are protected."
echo "Settings API Usage Dashboard shows live provider requests and searchable page-by-page API purposes."
echo "Portfolio stock removal: use Remove Position to select named tickers and review them before confirming. Distant row X buttons have been removed."
echo "Stock prices use labelled Hyperliquid equity-perpetual marks where mapped, including portfolio values and screener prices. Prices and covered charts stream live with native UTC 4-hour perp bars; Yahoo supplies stock-history and quote fallbacks plus fundamentals."
echo "Crypto includes Hyperliquid perpetual markets: mark prices, hourly funding, open interest and volume. Free public data loads at startup and refreshes every 60 seconds while Crypto is visible."
echo "Dependencies updated: Electron 45.1.0, query caching, MCP and Parquet readers. Virtual tables retain their tested version."
echo "Agent recovery: saved run details, temporary read retries, partial answers and Continue research. Manual run limits are configurable in Controls."
echo "Scorecard: compare 3-6 companies with saved comparisons, selectable metrics, fiscal-year labels and source details. The current comparison loads at startup."
echo "Portfolio and Personal Finance privacy: Obscure replaces numbers with **** while labels, controls and charts stay visible. Reveal restores values and numeric editing."
echo "Agent options: MCP refreshes expirations, chains and contract marks. Top-volume research ranks all loaded live expirations and reports missing coverage."
echo "Portfolio Dip Finder: Entry shows percentage gain or loss versus your average purchase price."
echo "Agent news: MCP news tools refresh sources before returning. Summaries check publication dates and report stale data or refresh failures."
echo "Agent reading: highlighting keeps streamed replies steady. Clear the selection to catch up; scroll to the bottom to follow new text."
echo "Performance updates: Quant pair calculations and SQLite persistence run in workers. Extra query memory is bounded, prepared startup pages stay available, and large tables render visible rows."
echo "Startup dependency fixes: Up/Down price targets preload before page readiness; Cards warms every interval after a partial result; News splits multi-ticker article labels into valid quote requests."

cd "$(dirname "$0")" || exit 1

# Dolphin and Steam do not inherit the PATH from an interactive terminal.
export PATH="$HOME/.local/bin:$HOME/.local/share/fnm/aliases/default/bin:$HOME/.volta/bin:$PATH"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is required. Install the latest Node.js 24 LTS, then run this launcher again." >&2
  exit 1
fi

echo "Settings API usage now shows startup health and a compact live provider table, with an expandable API and page directory. Failed and incomplete pages appear first in its startup status list."
echo "Live updates enabled: UI edits apply automatically; Electron edits rebuild and restart or reload. Keep this terminal open."
echo "All implemented pages preload at startup; progress and failures remain visible. Keep this terminal open."
echo "Settings Page Load Order includes Export for AI for a local startup diagnostic text report. Nothing is uploaded automatically."
echo "Includes bounded 4 MB News images, corrected daily S&P500 holdings freshness and expiry-aware WTI contract selection."
echo "Pre-Market futures recover through daily history when hourly feeds fail or return stale data; genuine outages remain visible."
exec node scripts/launch.cjs --dev
