<p align="center">
  <img src="docs/assets/readme-banner.svg" alt="Budget Terminal 2.0 — Your markets. Your research. Your workspace." width="100%">
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
  <a href="#explore-the-workspaces">Workspaces</a> ·
  <a href="#documentation">Documentation</a> ·
  <a href="https://github.com/Wong-Zhen-Yi/Budget-Terminal-2.0/issues">Report an issue</a>
</p>

---

## One workspace, from research to records

Budget Terminal brings public market data and your saved financial records into an
Electron app built with React and TypeScript. Move from a market overview to company
fundamentals, charts, options, and valuation while carrying the same ticker between
research pages.

| | What you can do |
| :--- | :--- |
| **🌍 Follow the markets** | Explore heatmaps, ETFs, forex, crypto, commodities, news, and economic events. |
| **🔎 Research companies** | Review fundamentals, valuation, institutional activity, [DefeatBeta Terminal](docs/defeatbeta-terminal.md), and focused company and semiconductor pages. |
| **📈 Study price action** | Work with charts, technical indicators, options chains, quantitative tools, and backtests. |
| **💼 Track your money** | Manage portfolios, personal finance, Cards, and projections with local saved records and backups. |
| **⚡ Open ready pages** | Every implemented page starts loading at launch, with startup progress and failures visible. |
| **🔗 Extend your workspace** | Connect local research tools through MCP while keeping the workspace in the desktop app. |

## Screenshots

Screenshots of the current app using an isolated demo profile. Holdings, prices,
headlines, and indicator values are illustrative sample data.

### Dashboard

Market snapshots, portfolio holdings, price action, analyst targets, and options
in one workspace.

![Budget Terminal Dashboard with demo holdings, a candlestick chart, market snapshots, and options tables](docs/assets/screenshots/dashboard.png)

<details>
<summary><strong>Charts — price action and technical tools</strong></summary>

Candlestick history, volume, moving averages, drawing tools, and portfolio context.

![Budget Terminal Charts workspace with demo candlesticks, volume, a moving average, and a portfolio sidebar](docs/assets/screenshots/charts.png)

</details>

<details>
<summary><strong>Portfolio — positions and allocation</strong></summary>

Position values, gains, portfolio weights, and performance snapshots.

![Budget Terminal Portfolio workspace with a five-position demo portfolio, gains, and allocation bars](docs/assets/screenshots/portfolio.png)

</details>

## Quick start

### 1. Get the source

```bash
git clone https://github.com/Wong-Zhen-Yi/Budget-Terminal-2.0.git
cd Budget-Terminal-2.0
```

### 2. Install and launch

Use **Node.js 24 LTS and npm 11** for a new installation. Supported versions are
Node.js **22.20+, 24.12+, or 26.x**, with **npm 10.9.8+**, as defined in
[package.json](package.json).

```bash
npm install
npm run dev
```

Prefer a launcher? Open the file for your operating system from the checkout:

| Windows | macOS | Linux |
| :--- | :--- | :--- |
| [Launch Budget Terminal.cmd](Launch%20Budget%20Terminal.cmd) | [Launch Budget Terminal.command](Launch%20Budget%20Terminal.command) | [Launch Budget Terminal.sh](Launch%20Budget%20Terminal.sh) |

Each launcher checks the runtime, installs dependencies, verifies Electron, builds
the latest source, and opens the production app. Keep its terminal open while using
Budget Terminal. Build or startup errors stay visible in the launcher window.

The launcher also checks Codex for the **Agents** page and passes the detected
executable to the app. It detects the Windows Codex desktop installation, native
CLI installations and native executables behind Windows npm shims. If Codex is
missing, the app still opens with setup instructions in Agents. The launcher
does not sign in or start agent work; autonomous mode remains off by default.

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

The build produces application bundles. Installer packaging and automatic
application updates are not configured.

</details>

## Explore the workspaces

The current navigation includes **50 implemented pages**, including Settings.

| Workspace | Pages |
| :--- | :--- |
| **Overview** | Dashboard, News, Calendar, YouTube, Dictionary |
| **Markets** | Pre-Market, Heatmap, Up/Down, Trading Volumes, Beta, Market Cap, Price, ETF, S&P500, Forex, Crypto, Gold, Oil |
| **Research** | Stocks, Discovery, Fundamentals, Valuation, Institutions |
| **Focus** | BMNR, Bitcoin, HOOD, HIMS, SOFI, MU, AMZN, AVGO, Semiconductors, VST |
| **Trading** | Charts, Options, Technical Indicators, Quant, Backtest |
| **Macro & events** | Global, Economic, Bonds, Money, IPO, Politics |
| **My money** | Portfolio, Personal Finance, Cards, Projections |
| **Articles** | Articles |
| **Settings** | Settings |

Star pages to pin Favorites. Use **Ctrl+K** or **backtick** to open page search;
recent pages appear first. Settings controls page visibility, ordering, favorites,
privacy, and the market clock.

The Research bar transfers a ticker to Stocks, Fundamentals, Charts, Options, or
Valuation. Clicking a portfolio ticker opens Stocks; options handoffs open a
single-expiration chain. Hidden pages remain hidden.

## Your data and your workspace

- **Local records and backups.** Financial records are saved outside the checkout.
  Settings provides JSON export/import, and saved changes update an automatic
  backup in Downloads. See [storage and backup details](docs/user-guide.md#saved-data-and-backups).
- **Visible data quality.** Supported panels show source, freshness, coverage, and
  partial-data issues. Public feeds can vary in availability; cached results keep
  their limitations visible. See [startup and data freshness](docs/user-guide.md#startup-and-data-freshness).
- **Desktop-only workspace.** Open Budget Terminal in Electron. Remote browser
  access, pairing, and the built-in web server are no longer included.
- **Local MCP tools.** Connect research and saved-record tools to supported local
  clients. Write tools edit local records, not broker orders. See the [MCP setup guide](docs/local-mcp.md).

## Documentation

- [Market data provider policy](docs/defeatbeta-backup.md) — Yahoo Finance market data, explicit source failures, and the dedicated DefeatBeta research page.
- [DefeatBeta Terminal](docs/defeatbeta-terminal.md) — ten research tabs, published datasets, startup loading, and valuation assumptions.

| Guide | What's inside |
| :--- | :--- |
| [Data, startup & backups](docs/user-guide.md) | All-page readiness, feed health, saved-data locations, migration, and backup behavior. |
| [Local MCP](docs/local-mcp.md) | Client registration, research tools, record edits, screenshots, and bridge security. |
| [Development](docs/development.md) | Architecture, verification commands, security checks, and data-layer conventions. |
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
Keep credentials, personal financial records, and generated bundles out of commits.

---

<p align="center">
  <strong>Budget Terminal 2.0</strong><br>
  Markets, research, and personal finance in one desktop workspace.
</p>
