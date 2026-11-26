<p align="center">
  <img src="apps/desktop/resources/budget-terminal-fold.png" alt="Budget Terminal — Fold logo with code and candlesticks" width="100%">
</p>

<h1 align="center">Budget Terminal 2.0</h1>

<p align="center">
  <strong>A desktop workspace for market research, portfolio tracking, and personal finance.</strong><br>
  Explore markets, follow companies, and keep your financial records together.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Electron-Desktop-47848F?logo=electron&amp;logoColor=white" alt="Electron desktop app">
  <img src="https://img.shields.io/badge/React-UI-149ECA?logo=react&amp;logoColor=white" alt="React user interface">
  <img src="https://img.shields.io/badge/TypeScript-Strict-3178C6?logo=typescript&amp;logoColor=white" alt="Strict TypeScript">
  <img src="https://img.shields.io/badge/Data-Local%20storage-22C55E" alt="Local data storage">
</p>

<p align="center">
  <a href="#quick-start">Quick start</a> ·
  <a href="#screenshots">Screenshots</a> ·
  <a href="#mobile-ui-showcase">Mobile UI</a> ·
  <a href="#explore-the-workspaces">Workspaces</a> ·
  <a href="#documentation">Documentation</a> ·
  <a href="https://github.com/Wong-Zhen-Yi/Budget-Terminal-2.0/issues">Report an issue</a>
</p>

---

## One workspace, from research to records

On Windows, double-click **Launch Budget Terminal.cmd** in `launchers/windows` to open the desktop app
directly. You can also type `btd` in a new terminal. To download app updates, use **Settings → App dashboard → Check for updates** or run `btd update`.
See [Quick start](#quick-start).

Budget Terminal brings public market data and your saved financial records into an
Electron app built with React and TypeScript. Move from a market overview to company
fundamentals, charts, options, and valuation while carrying the same ticker between
research pages.

| | What you can do |
| :--- | :--- |
| **🌍 Follow the markets** | Explore heatmaps, ETFs, forex, crypto, commodities, news, and economic events. |
| **🔎 Research companies** | Review fundamentals, valuation, institutional activity, [DefeatBeta Terminal](docs/defeatbeta-terminal.md), and focused company and semiconductor pages. |
| **🌐 Browse the sources** | Use the embedded [Browser](docs/browser.md) with shared Chromium tabs, source text reading, and agent research access enabled by default with Disable and Stop controls. Login profiles stay outside source/Git, with ignore rules and commit/push checks against accidental publication. |
| **📈 Study price action** | Work with charts, technical indicators, options chains, quantitative tools, and backtests. |
| **Explore prediction markets** | Search Polymarket events and inspect outcome probabilities, price history, order-book depth, and activity through public read-only data. |
| **💼 Track your money** | Manage portfolios, personal finance, Cards, and projections with local saved records and backups. |
| **⚡ Open ready pages** | Every implemented page starts loading at launch. Startup progress, failures, and diagnostic logs stay in Settings. |
| **Saved pages at launch** | Use cached content while every page refreshes. Settings controls separate page, market-data and image budgets, retention and cache diagnostics. |
| **🔗 Extend your workspace** | Connect local research tools through MCP while keeping the workspace in the desktop app. |
| **Work with Agents** | Use the embedded Codex, Claude Code or Claude workspace for research and local alerts, with autonomous mode off by default. |
| **Use your phone** | Open a connected phone viewport on Windows, or enable private phone and tablet access through Tailscale. Telegram provides mobile links and agent quick prompts when configured. |

## Screenshots

Captured from the **rendered desktop app** on 24 November 2026 using the checked-in
[demo portfolio](fixtures/demo-user-data.json), with the full application shell and
current dark theme. Holdings and financial records are fictional. Market panels
use the usual public providers and may contain delayed, cached, or unavailable data.
See [capture details](docs/assets/screenshots/README.md).

### Portfolio

The Demo Core Portfolio brings positions, cost basis, gains, cash, and portfolio
controls together. A second Demo Income Portfolio is included in the demo profile.

![Rendered Portfolio in the isolated demo app](docs/assets/screenshots/portfolio.png)

### Dashboard 2.0

A portfolio-led overview with market context and research tools.

![Rendered Dashboard 2.0 in the isolated demo app](docs/assets/screenshots/dashboard-2.png)

<details>
<summary><strong>Personal Finance</strong></summary>

Sample accounts, assets, liabilities, recurring bills, and a savings goal.

![Rendered Personal Finance in the isolated demo app](docs/assets/screenshots/personal-finance.png)

</details>

<details>
<summary><strong>Charts</strong></summary>

Price action, volume, technical tools, and demo portfolio watchlists.

![Rendered Charts in the isolated demo app](docs/assets/screenshots/charts.png)

</details>

<details>
<summary><strong>Focus Dashboard</strong></summary>

Find company, industry, digital-asset, commodity, and macro research topics.
Each topic has its own research layout.

![Rendered Focus Dashboard in the isolated demo app](docs/assets/screenshots/focus-dashboard.png)

</details>

<details>
<summary><strong>Dictionary</strong></summary>

Browse offline financial terms and illustrated chart patterns.

![Rendered Dictionary in the isolated demo app](docs/assets/screenshots/dictionary.png)

</details>

## Mobile UI showcase

The same workspace adapts to phones with stacked panels, touch-sized controls,
collapsible tools, and swipeable tables. Tap the page name to open **Workspaces**
and search or select a page.

<p align="center">
  <img src="docs/assets/screenshots/mobile-portfolio.png" alt="Mobile Portfolio with fictional demo holdings and compact controls" width="30%">
  <img src="docs/assets/screenshots/mobile-dashboard-2.png" alt="Mobile Dashboard 2.0 with stacked demo portfolio panels" width="30%">
  <img src="docs/assets/screenshots/mobile-workspaces.png" alt="Mobile Workspaces navigation with searchable grouped page pills" width="30%">
</p>

<details>
<summary><strong>Mobile Charts — price history and compact chart tools</strong></summary>

<p align="center">
  <img src="docs/assets/screenshots/mobile-charts.png" alt="Rendered mobile Charts with SPY candles, volume, and the demo portfolio sidebar" width="320">
</p>

</details>

**How it works:** Budget Terminal stays open on your computer and serves the mobile
UI with its shared saved records and market services. Enable **Settings → Labs →
Mobile Access**, connect your computer and phone to the same Tailscale account,
and open the private link in your phone browser. Telegram's `/mobile` command can
send you that link when configured. Mobile edits save to the desktop records;
page navigation and scroll positions are independent.

On Windows, **Open phone viewport** in Settings opens a connected, resizable local
window without Tailscale. To try sample data, run `btd -MobilePreview`.
The images above are actual renders of that disposable preview at 390 × 844 CSS
pixels, rather than captures from physical phones. Demo profiles
cannot be shared remotely. See the [Mobile Access guide](docs/mobile-access.md)
for setup and device-specific behavior.

## Quick start

### 1. Get the source

```bash
git clone https://github.com/Wong-Zhen-Yi/Budget-Terminal-2.0.git
cd Budget-Terminal-2.0
```

### 2. Install and check the setup

Windows has a double-click launcher in [launchers/windows](launchers/windows) and Linux
has one in [launchers/linux](launchers/linux). On macOS, start the app with
`sh scripts/launch-posix.sh` from the checkout.
Point any shortcuts or aliases that used the repository root to the new location.

On Windows, double-click [Launch Budget Terminal.cmd](launchers/windows/Launch%20Budget%20Terminal.cmd)
from the checkout. It installs or repairs a supported Node.js runtime, dependencies
and Electron, builds and checks the desktop app, and installs or updates the per-user
`btd` command. Dependency checks and build output appear in the launcher terminal,
then the desktop app opens directly. Keep that terminal open while using the app.
The launcher shows five numbered stages with completion times, live installation
and build output, and a final check result. Colours follow the app's accents;
redirected output and `NO_COLOR` use plain text.
Setup also removes the retired
`bt` command when it belongs to this checkout.
Every launch, including the first launch from a fresh checkout, runs `npm install`,
checks or repairs Electron, builds the app and verifies its files before opening it.
Failed dependency checks stop startup. There is no interface selection menu, and
`btd` uses the same dependency checks when launched from a terminal.
No administrator access is needed. Double-click it again whenever you need to open
the app. From the checkout, `npm.cmd run setup` runs the Windows checks without opening the app.

On macOS, run `sh scripts/launch-posix.sh` from the checkout in Terminal.
It checks the runtime, installs dependencies, builds the latest source and opens
the desktop app. Keep its Terminal window open while using the app. Homebrew,
Volta, fnm and nvm installation locations are checked automatically. If needed,
the launcher downloads and verifies Node.js with npm and installs it under
`~/Library/Application Support/BudgetTerminal/runtimes` without administrator
access. Launch errors stay visible so you can fix them and retry.

For a manual installation on any platform:

Use **Node.js 24 LTS and npm 11** for a new installation. Supported versions are
Node.js **22.23.4+, 24.22.1+, or 26.12.1+**, with **npm 10.9.8+**, as defined in
[package.json](package.json).

```bash
npm install
npm run dev
```

On Steam Deck, switch to **Desktop Mode** and install the desktop and application
menu shortcuts once from the checkout:

```bash
npm run setup:linux
```

On any Linux desktop, double-click [Launch Budget Terminal.sh](launchers/linux/Launch%20Budget%20Terminal.sh)
(choose **Run** or **Execute** if the file manager asks; in Ubuntu's Files, right-click it and
choose **Run as a Program**), double-click **Budget Terminal 2.0** on the desktop or open it from
the app menu after `npm run setup:linux`, or run `sh scripts/launch-posix.sh` from the checkout.
`npm run setup:linux` (and every regular launch) also installs a `btd` command in `~/.local/bin`.
It has the same commands and options as on Windows, including `btd restart` and `btd mobile`.
On Ubuntu 23.10+, if Electron reports "No usable sandbox", run
`sudo chown root:root node_modules/electron/dist/chrome-sandbox && sudo chmod 4755 node_modules/electron/dist/chrome-sandbox`
from the checkout.
If no supported Node.js is installed, the launcher downloads and verifies Node.js 24
into `~/.local/share/budget-terminal` without administrator access.
The launcher checks the runtime, installs dependencies, builds the latest source,
and opens the desktop app. Keep its terminal open while using the app. It finds
Node in `~/.local/bin`, fnm's default alias, Volta, or a per-user Budget Terminal
runtime, and installs that runtime when none is found; no SteamOS system changes
or administrator access are required. Re-run `npm run setup:linux` to refresh shortcuts
that still point to the old launcher location or after moving the checkout. For
Gaming Mode, add the application menu entry as a non-Steam game and leave Proton
compatibility disabled.

Steam Deck Desktop Mode opens the window within the display's usable area,
including panel offsets and desktop scaling. The window refits when docking,
undocking or changing resolution. Gaming Mode (Gamescope) opens in native
fullscreen. The title-bar restore button exits fullscreen.

Basic controller support works with standard gamepads while the desktop app has
focus. Use the D-pad or left stick to move focus, A/Cross to activate, B/Circle to
dismiss or leave a text field, LB/RB (L1/R1) to switch pages, Menu/Options to open
the page picker, and the right stick to scroll. Hold a direction to repeat.
Page switching follows the workspace order in the sidebar and the page buttons
within each workspace, including custom ordering and hidden pages. Steam Input
layouts that map the D-pad to keyboard arrows follow the same order.
Select fields use up/down to change and left/right to leave. Text entry and
embedded browser content still require a keyboard, touch or mouse. On Steam
Deck, select a **Gamepad** Steam Input layout to expose controller buttons;
desktop mouse layouts can still be used as usual. The control reference is in
Settings → Workspace → Keyboard Shortcuts → Controller controls.

### 3. Open Budget Terminal

After Windows setup, open a new PowerShell or Command Prompt window and type `btd`
for the desktop app.

Double-click launchers show dependency checks and build output in their terminal.
Keep that terminal open while using the app. Development mode also requires its
terminal to stay open.

`btd` works from any directory. It shows the five startup stages and build output
in your terminal, then opens the desktop app independently. Once the launcher
confirms it has launched Budget Terminal, you can close that terminal.
To install or repair it manually on Windows, run `npm run setup:desktop` from the checkout.
The detached desktop process writes its output under `%LOCALAPPDATA%\BudgetTerminal\launcher-logs`.
`btd restart` gracefully closes the running app, waits for pending saves, rebuilds the latest source and reopens it. If the app is closed, it starts it. A shutdown timeout stops the launch and reports the error in the terminal.
Run `btd --help` for the full list of commands and options, including `btd -Dev`
for live reloading, `btd -Logs` to open diagnostics, and `btd -Attached` to keep
the app's runtime output in the terminal. To remove only the `btd` command,
run `powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/install-bt.ps1 -Uninstall`.

### Update Budget Terminal

Open **Settings → App dashboard** and click **Check for updates**. If an update is available, choose **Install update**. `btd update` checks and applies the same source update from any directory on Windows and Linux. On macOS, run `sh scripts/launch-posix.sh update` from the checkout.

Updates use the project's published `main` branch and require Git and a clean checkout on `main` that can be fast-forwarded. After updating, close Budget Terminal and reopen it with the launcher to rebuild the app and MCP tools. `btd restart` handles both steps.

### Test with demo data

The demo is for development checks, screenshots and UI smoke tests, so it has no
double-click launcher. On Windows, run `btd -Demo`. On macOS or Linux, run
`sh scripts/launch-posix.sh --demo` from the checkout. Keep the terminal open until
you close the demo app.

The app displays **Demo data** in the top bar. It opens with two sample portfolios, an options record,
personal finance entries and a goal, chart watchlists, a backtest allocation, custom cards, and articles.
Each launch copies the checked-in [demo fixture](fixtures/demo-user-data.json) into a fresh temporary profile.
Edits and automatic backups go into that profile, alongside its own browser session and cache.
The regular launcher still opens your personal profile, and cloud sync is disabled in the demo.
Market prices still use the app's usual providers.

Select **Open phone viewport** under **Settings → Labs → Mobile Access** to open your desktop workspace in a resizable phone window, with compact through large phone presets. After an update, run `btd mobile` to save, rebuild, and reopen with the viewport. To use temporary sample data, run `btd -MobilePreview`. See [Mobile Access](docs/mobile-access.md#open-the-connected-mobile-window) for details.

### Launch behavior and troubleshooting

On Windows, the app bypasses Chromium's GPU shader disk caches to avoid locked-file
and access-denied errors during startup or relaunch. GPU acceleration stays enabled;
shaders may need to compile again on each launch. Saved application data and Browser
login profiles are preserved, and existing cache files do not need to be deleted.

On Windows, the double-click launcher finds a supported Node.js installation even
when an older version comes first on PATH. If none is available, it downloads
Node.js 24.22.1 from nodejs.org, checks the pinned SHA-256 checksum, and installs it
under `%LOCALAPPDATA%\BudgetTerminal\runtimes`. This needs no administrator access
and keeps the runtime outside the checkout. Internet access is required for the
first download; subsequent launches reuse it. On Windows, the root `npm run dev`
command uses this same runtime recovery, even if your shell has an older Node.js.
Other command-line `npm` commands still use the Node.js installation configured in
your shell.

For the desktop app with live code updates, run
`npm run dev` from the repository root. Close any existing Budget Terminal window
first (the app allows only one running instance). Live mode checks dependencies,
verifies Electron and builds MCP tools before starting `electron-vite dev --watch`.
UI edits update automatically; Electron main/preload edits trigger rebuilds and
restarts or reloads. Keep the terminal open. Close and relaunch an existing production
window once to enable live updates. For a fixed production build, run
`node scripts/launch.cjs` instead.

These Node minimums include the October 2026 eMudhra certificate compromise fix.
Electron **45.1.0** includes the corresponding native SPKI blocklist for
both Node TLS (including Yahoo workers) and Chromium research tabs. Electron's
embedded Node version is separate from the system Node installation; keep both
runtimes patched and fully restart the app after updating. Startup rejects
certificate-verification bypasses, and the launcher forces npm certificate checks.
See the [certificate security notes](docs/certificate-security.md) for verification
and guidance for separate Python environments.

The launcher also checks Codex for the **Agents** page and passes the detected
executable to the app. It detects the Windows Codex desktop installation, native
CLI installations and native executables behind Windows npm shims. If Codex is
missing, the app still opens with setup instructions in Agents. To use your
Claude Code sign-in instead, choose **Provider → Claude Code** (see
[Agents](docs/agents.md#claude-code-provider)); to use a Claude API key, choose
**Provider → Claude** (see [Agents](docs/agents.md#claude-provider)). The launcher does not sign in or start
agent work; autonomous mode remains off by default.

<details>
<summary><strong>Electron repair and production bundles</strong></summary>

Installation verifies Electron automatically. If its download was interrupted, run:

```bash
npm run ensure:electron
```

To build and preview the desktop bundles:

```bash
npm run build
npm run preview --workspace budget-terminal-desktop
```

The build produces application bundles. Installer packaging is not configured.
Source updates are available through Settings and the launcher commands above;
relaunch to rebuild the app.

</details>

## Explore the workspaces

The current navigation includes **67 implemented pages**, including Settings and two optional Labs pages.
Enable Dashboard Lite and News Lite from Settings → Labs.

| Workspace | Pages |
| :--- | :--- |
| **Overview** | Dashboard, Dashboard 2.0, Dashboard Lite (Labs), Pre-Market, News, News Lite (Labs), Calendar, YouTube, Dictionary |
| **Markets** | Heatmap, Up/Down, Trading Volumes, Beta, Market Cap, Price, ETF, S&P500, Forex, Crypto, Polymarket |
| **Research** | Browser, Stocks, Discovery, Fundamentals, Scorecard, DefeatBeta Terminal, Valuation, Institutions |
| **Focus** | Focus Dashboard, Macro, BMNR, Bitcoin, Ethereum, PLTR, HOOD, HIMS, SOFI, MU, GOOGL, Anthropic, AMZN, AVGO, NVDA, Semiconductors, Homebuilders, VST, Gold, Oil |
| **Trading** | Charts, Options, Technical Indicators, Quant, Backtest |
| **Macro & events** | Global, Economic, Bonds, Money, IPO, Politics |
| **My money** | Portfolio, Personal Finance, Cards, Projections |
| **Articles** | Articles |
| **Agents** | Agents |
| **Notifications** | Notifications |
| **Settings** | Settings |

YouTube picture in picture opens a separate, always-on-top desktop window. Drag its title bar anywhere, including outside Budget Terminal, and resize its edges. Use **Return** to bring the same video back to the page without restarting playback, or the close button to stop it. PiP stays visible when the main app is minimized and closes with the app.

**Polymarket** provides searchable market cards, topic filters, outcome probability
charts, order-book depth, and activity, plus an explorer for public datasets.
It loads at startup and is available through local MCP read tools. The workspace
uses public, unauthenticated data and does not place orders.

**Crypto Workspace** uses a chart-focused layout with a selectable spot watchlist,
equity/ETF proxies, Top 30 breadth, market context, news and searchable perpetual
markets. Its Hyperliquid perpetual chart has 15-minute, hourly, four-hour and daily
candles, volume, zoom and pan. The initial chart loads at startup even when Crypto
has not been visited; symbol and interval changes are prepared by the same startup
scheduler. Chart history refreshes once a minute while visible and is explicitly
separate from the live venue mark and spot quotes.

CoinGecko calls from Crypto and BMNR share a five-request-per-minute app budget,
endpoint caches and an enforced 429 cooldown that respects `Retry-After`. The page
shows the actual cooldown countdown and retains available source-labelled data.
Manual refresh cannot bypass the provider cooldown or its endpoint cache.

The **Hyperliquid Perpetuals** table includes mark prices, 24-hour
changes, hourly funding rates, USD open interest, and 24-hour volume. It uses the
free public market-data API without an API key or wallet, loads at startup, and
shares the equity WebSocket for live updates, with REST fallback when unavailable.
Other Crypto feeds refresh every 60 seconds while the page is visible. Sort columns to explore the
active markets. Hyperliquid failures appear in page readiness and panel warnings;
the other crypto feeds remain available. These are venue-specific perpetual
contracts, displayed separately from spot quotes. No trading actions are exposed.

Crypto prices use CoinGecko spot quotes with explicitly labelled Hyperliquid
perpetual fallbacks. The shared quote API follows the same routing, including when
a Finnhub key is configured. CoinGecko supplies top-30 rankings, market caps and
global totals; missing coverage stays visible instead of switching coin providers.
Stock/ETF proxies retain stock quote providers and separately cached Yahoo stock
metadata. See [public data routing](docs/public-data-routing.md) for details.

**Stock quotes and charts** prefer explicitly mapped Hyperliquid equity perpetuals.
These USD **mark prices** also value portfolio positions, gains and allocations.
Their percentage changes use a rolling **24-hour** basis. One shared WebSocket
streams marks and actual venue candles; reconnects restore subscriptions. Stock
and chart views identify the price and candle sources separately. Source labels
and PERP badges distinguish these derivative marks from stock-exchange prices.
Market Cap, Price, Heatmap and Crypto equity-proxy displays share these marks.
Screen candidates and historical-return metrics remain Yahoo stock data; the Price
screen filters its returned candidates against the selected displayed marks.

Yahoo remains the source for fundamentals, unsupported symbols, adjusted return
analytics and longer stock histories. A chart switches as a complete series when
Hyperliquid cannot cover the requested range or its 5,000-candle window; it never
joins stock candles to perp candles. Indicators use the chart's instrument.
Quote outages use labelled Yahoo fallbacks and remain visible in data readiness.
The reviewed market mappings are in `apps/desktop/electron/shared/equityMarkets.ts`;
SOFI and VST use `para` markets and most other mapped stocks use `xyz`.
Run `npm run probe:hyperliquid` for deterministic checks, or append `-- --live`
to verify prices, candles and WebSocket updates against the public API.

Charts for tickers in every portfolio preload at startup and stay cached while the
app runs. This covers Stocks and the selected Dashboard, Main and Multi chart views.
New holdings and changes to chart intervals or ranges prepare those views automatically.
Background refresh continues across pages and unfocused windows. Heatmap snapshots
refresh every 30 minutes; AMZN, MU, AVGO, VST, SOFI, HIMS, HOOD, PLTR, BMNR and
Semiconductors market snapshots refresh hourly, as does Personal Finance FX.
Dashboard headlines refresh every five minutes. Shared live price streams continue
to update covered market marks independently of these snapshot schedules.
Backtest prepares saved inputs and a separate quote snapshot at startup, then waits
for Run or an explicit reload; it has no automatic refresh or periodic quote polling.
The bottom status
strip is hidden while startup loading, chart observers and API monitoring keep running.
Readiness and failures remain available in Settings; refresh failures retain the last
usable chart.

Yahoo U.S. cash-equity quotes and chart history reuse checked closing data until the
next regular market opening, including weekends and scheduled exchange holidays.
The cache keeps checking for 20 minutes after the close to collect delayed final
updates. During trading, the normal quote and chart checks resume. Actual trade and
snapshot timestamps remain visible; a check being due does not erase historical data.
Manual refresh bypasses this reuse, and unknown exchanges, futures, FX, crypto and
Hyperliquid perpetuals retain their existing schedules. Chart updates download the
overlapping recent tail, with periodic reconciliation for historical corrections.

MCP and embedded Agents use the same Hyperliquid routing. `budget_terminal_quotes`
refreshes current prices, prefers the shared live stream, and skips macro quotes
and sector lookups by default. Request `includeMacro: true` or `includeSectors: true`
to include them. Compact, projected and paginated responses retain instrument,
currency, price/change basis and fallback labels in `response.provenance`.

Star pages to pin Favorites. Use **Ctrl+K** or **backtick** to open page search;
recent pages appear first. Settings controls page visibility, ordering, favorites,
privacy, and the market clock.

**Notifications** is the shared local inbox for Agent alerts, market openings,
and tests. Existing Agent alerts migrate automatically. Use **Send test notification**
to check desktop delivery. Windows notification settings and Do not disturb control
whether banners appear; delivery failures remain visible in the inbox.

The page offers **Enable market-open reminder** for a desktop alert at the regular
U.S. equity opening, 9:30 AM New York time. The next alert is displayed in Singapore
time, with daylight saving adjustments, weekends, and scheduled exchange holidays
handled automatically. The setting survives relaunch; old missed openings are
skipped. Keep the app open for delivery.

The Research bar transfers a ticker to Stocks, Fundamentals, Charts, Options, or
Valuation. Clicking a portfolio ticker opens Stocks; options handoffs open a
single-expiration chain. Hidden pages remain hidden.

**Scorecard** compares 3–6 companies with selectable, sortable financial and
valuation columns and a metric comparison chart. Save named comparisons locally,
then restore their tickers, columns, and chart metric. Annual metrics show each
company's fiscal year end; financial amounts use Fundamentals' USD normalization.
Source details retain freshness, currency conversions, and partial-data warnings.
The current comparison loads at startup, including when Scorecard is unvisited.

## Your data and your workspace

- **Local records and backups.** Financial records are saved outside the checkout.
  Settings provides JSON export/import, and saved changes update an automatic
  backup in Downloads. See [storage and backup details](docs/user-guide.md#saved-data-and-backups).
- **Visible data quality.** Supported panels show source, freshness, coverage, and
  partial-data issues. Public feeds can vary in availability; cached results keep
  their limitations visible. See [startup and data freshness](docs/user-guide.md#startup-and-data-freshness).
- **Desktop and connected mobile.** Run the main workspace in Electron. Optional
  Mobile Access serves the same records and market services to phones and tablets
  over Tailscale while the app runs. Windows also offers a resizable local phone
  viewport, and a disposable mobile preview uses demo records. See [Mobile Access](docs/mobile-access.md).
- **Local MCP tools.** Connect research and saved-record tools to Claude Code,
  Claude Desktop, ChatGPT, Codex and other local MCP clients. Write tools edit
  local records, not broker orders. See the [MCP setup guide](docs/local-mcp.md).
- **Optional encrypted credentials.** Settings → Integrations can store Finnhub
  and Financial Modeling Prep API keys encrypted locally. These integrations
  remain inactive, even with saved keys; current data services use public endpoints.
  Browser login profiles, Agent history, and credentials belong outside the checkout.

## Documentation

- [Market data provider policy](docs/defeatbeta-backup.md) — Yahoo Finance fundamentals and history, source failures, and the dedicated DefeatBeta research page.
- [DefeatBeta Terminal](docs/defeatbeta-terminal.md) — ten research tabs, published datasets, startup loading, and valuation assumptions.

| Guide | What's inside |
| :--- | :--- |
| [Optional Convex sync](docs/convex-sync.md) | Cross-device snapshot sync, Google browser sign-in, offline local saves, conflict recovery and deployment. |
| [Data, startup & backups](docs/user-guide.md) | All-page readiness, feed health, saved-data locations, migration, and backup behavior. |
| [Public data routing](docs/public-data-routing.md) | Hyperliquid/CoinGecko crypto quotes, World Bank/IMF annual context, and provider budgets. |
| [Browser](docs/browser.md) | Embedded Chromium tabs, source reading, research controls, and local login profiles. |
| [Diagnostic logging](docs/diagnostic-logging.md) | Settings log viewer, retention, export, and privacy. |
| [Local MCP](docs/local-mcp.md) | Client registration (Claude Code, Claude Desktop, Codex), prompts, research tools, record edits, screenshots, and bridge security. |
| [Mobile Access](docs/mobile-access.md) | Open Budget Terminal on your phone or tablet through Tailscale and get the private link from Telegram. |
| [Development](docs/development.md) | Architecture, verification commands, security checks, and data-layer conventions. |
| [Design archive](docs/design-prototypes/README.md) | Curated page prototypes, branding concepts, source prompts, and renderers. |
| [Semiconductors](docs/semiconductors.md) | Semiconductor supply-chain research and data sources. |
| [Chart pattern reference](apps/desktop/docs/chart-patterns/README.md) | Pattern examples and chart reference images. |

## Contributing

Bug reports and focused improvements are welcome. When reporting an issue, include
your operating system, runtime versions, steps to reproduce, and relevant errors.

For code changes, follow [the repository guidelines](AGENTS.md), run TypeScript and
the relevant probes, and smoke-test visible changes:

```bash
npm run typecheck
npm run probe:charts -- --offline
```

See the [development guide](docs/development.md#verification) for additional checks.
`@tanstack/react-virtual` remains pinned to **3.13.12**: version 3.14.24 fails
the 10,000-row table sorting check. Run `probe:performance-ui` in the desktop
workspace before changing that pin.
Keep credentials, personal financial records, browser profiles, Agent history, and
generated bundles out of commits.

### Diagnostic logs

Persistent local diagnostics are enabled automatically. Open **Settings → Diagnostics**
or press **Ctrl+Shift+L** inside Budget Terminal for live logs, filtering, record
inspection, and JSONL export. Retained records remain available across restarts.
Startup progress and failures stay in Settings; the global Page Loading Status
banner and bottom status strip remain hidden. See [Diagnostic logging](docs/diagnostic-logging.md).

---

<p align="center">
  <strong>Budget Terminal 2.0</strong><br>
  Markets, research, and personal finance in one desktop workspace.
</p>
