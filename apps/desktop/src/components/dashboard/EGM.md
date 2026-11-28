# src/components/dashboard

## Overview
Dashboard panels: news, options, portfolio (positions, pie, heatmap), targets, chart, and the macro bar, plus the lite dashboard variants.

## Interface
- `ChartPanel`, `MacroBar`, `NewsPanel`, `DashboardLiteNews`, `DashboardLiteOptions`, `OptionsPanel`, `PortfolioHeatmapPanel`, `PortfolioPanel`, `PortfolioPiePanel`, `TargetsPanel`, `DashboardLite`.

## Invariants
- None verified in this scan.

## Side Effects
- None (renders props or hook data).

## Verification
- Run: `npm run typecheck`
- Run: `npm run probe:dashboard-ui` after `npm run build`
