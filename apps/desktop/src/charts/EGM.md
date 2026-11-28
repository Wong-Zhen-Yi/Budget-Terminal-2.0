# src/charts (shared chart renderers)

## Overview
Chart components that are shared across pages: the dashboard price chart, the ETH trend chart, and the layout and series helpers for the stock chart.

## Interface
- `PriceChart.tsx:PriceChart`, `PriceChart.tsx:DASHBOARD_INDICATOR_COLORS`.
- `EthTrendChart.tsx:EthTrendChart`.
- `seriesUpdates.ts:syncTimeSeries`.
- `stockChartLayout.ts:stockChartRange`, `stockChartLayout.ts:fitStockChart`, `stockChartLayout.ts:layoutIndicatorPanes`.

## Invariants
- Chart series colours follow the locked palette and keep their existing series meanings ([AGENTS.md:Locked Colour Scheme]).

## Side Effects
- None beyond rendering. Chart updates rely on the series data passed in from `api/`.

## Verification
- Run: `npm run typecheck`
- Run: `npm run probe:charts -- --offline`
