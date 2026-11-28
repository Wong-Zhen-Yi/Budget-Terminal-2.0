# src/components (UI components)

## Overview
Reusable UI and per-page component folders. Shared primitives live in `ui/`, `chrome/`, and `charts/`. Other folders hold components for one page or domain, such as `portfolio/`, `settings/`, or `news/`. Pages compose these components; the components keep the locked palette ([AGENTS.md:Locked Colour Scheme]).

## Subdirectories & Boundaries
- `agents`: [./agents/EGM.md](./agents/EGM.md) - Agents chat, charts, and settings.
- `anthropic`: [./anthropic/EGM.md](./anthropic/EGM.md) - Anthropic charts.
- `articles`: [./articles/EGM.md](./articles/EGM.md) - Article blocks, export, and visuals.
- `auth`: [./auth/EGM.md](./auth/EGM.md) - Sign-in popup.
- `bonds`: [./bonds/EGM.md](./bonds/EGM.md) - Bond calculator.
- `calendar`: [./calendar/EGM.md](./calendar/EGM.md) - Economic readings in the calendar.
- `cards`: [./cards/EGM.md](./cards/EGM.md) - Card editor, basket, and strategy card.
- `charts`: [./charts/EGM.md](./charts/EGM.md) - Shared chart primitives (bar, candlestick, line, pattern, treemap).
- `chartsworkstation`: [./chartsworkstation/EGM.md](./chartsworkstation/EGM.md) - Charts workspace.
- `chartwindow`: [./chartwindow/EGM.md](./chartwindow/EGM.md) - Detached chart window.
- `chrome`: [./chrome/EGM.md](./chrome/EGM.md) - Tab bar, status bar, sidebar, and top bar.
- `crypto`: [./crypto/EGM.md](./crypto/EGM.md) - Crypto heatmap and price chart.
- `dashboard`: [./dashboard/EGM.md](./dashboard/EGM.md) - Dashboard panels.
- `defeatbeta`: [./defeatbeta/EGM.md](./defeatbeta/EGM.md) - DefeatBeta price chart.
- `economic`: [./economic/EGM.md](./economic/EGM.md) - Economic tables and series charts.
- `etf`: [./etf/EGM.md](./etf/EGM.md) - ETF holdings, arbitrage, and AUM.
- `eth`: [./eth/EGM.md](./eth/EGM.md) - Ethereum market view.
- `finance`: [./finance/EGM.md](./finance/EGM.md) - Personal finance panels.
- `focus`: [./focus/EGM.md](./focus/EGM.md) - Focus card metrics.
- `forex`: [./forex/EGM.md](./forex/EGM.md) - Currency converter.
- `fundamentals`: [./fundamentals/EGM.md](./fundamentals/EGM.md) - Fundamentals chart and filings.
- `global`: [./global/EGM.md](./global/EGM.md) - Global markets map and table.
- `heatmap`: [./heatmap/EGM.md](./heatmap/EGM.md) - Index heatmap.
- `homebuilders`: [./homebuilders/EGM.md](./homebuilders/EGM.md) - Homebuilder capital map and buyer economics.
- `ipo`: [./ipo/EGM.md](./ipo/EGM.md) - IPO tables.
- `macro`: [./macro/EGM.md](./macro/EGM.md) - Macro sparkline.
- `news`: [./news/EGM.md](./news/EGM.md) - News reader, sections, and toolbar.
- `options`: [./options/EGM.md](./options/EGM.md) - Option chain tables.
- `pltr`: [./pltr/EGM.md](./pltr/EGM.md) - Palantir volume and valuation.
- `portfolio`: [./portfolio/EGM.md](./portfolio/EGM.md) - Positions, dialogs, and metrics.
- `premarket`: [./premarket/EGM.md](./premarket/EGM.md) - Futures, macro, and fear-and-greed panels.
- `price`: [./price/EGM.md](./price/EGM.md) - Price scatter plot.
- `projections`: [./projections/EGM.md](./projections/EGM.md) - Projections chart.
- `scorecard`: [./scorecard/EGM.md](./scorecard/EGM.md) - Scorecard matrix and analysis.
- `semiconductors`: [./semiconductors/EGM.md](./semiconductors/EGM.md) - Supply chain explorer.
- `settings`: [./settings/EGM.md](./settings/EGM.md) - Settings panels.
- `stocks`: [./stocks/EGM.md](./stocks/EGM.md) - Stocks chart.
- `tradingvolumes`: [./tradingvolumes/EGM.md](./tradingvolumes/EGM.md) - Trading volume table and plots.
- `ui`: [./ui/EGM.md](./ui/EGM.md) - Shared primitives (Button, Modal, Panel, DataTable, Select, and others).
- `valuation`: [./valuation/EGM.md](./valuation/EGM.md) - Valuation assumptions and fair-value chart.
- `youtube`: [./youtube/EGM.md](./youtube/EGM.md) - YouTube player.

## Invariants
- The palette comes from the shared tokens in `styles/theme.css`. Do not add competing hard-coded theme colours ([AGENTS.md:Locked Colour Scheme]).
- No Page Loading Status banner or equivalent strip ([AGENTS.md:No Global Diagnostics Banners]).

## Side Effects
- Most components render props or hook data only. The exceptions are listed in their own contracts.

## Verification
- Run: `npm run typecheck`
- Run: `npm run probe:readiness-ui` after `npm run build` for UI changes
