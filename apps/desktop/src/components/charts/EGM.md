# src/components/charts (shared chart primitives)

## Overview
Reusable chart primitives: bar, line, candlestick, pattern, and treemap charts. Shared series colours live here.

## Interface
- `BarChart`, `LineChart`, `CandlestickChart`, `PatternChart`, `Treemap`.
- `SERIES_COLORS`, `colorForIndex` - the series colour palette helpers.
- `squarify` - treemap layout helper.

## Invariants
- Chart colours use the existing series meanings and the locked palette ([AGENTS.md:Locked Colour Scheme]).

## Side Effects
- None (renders props only).

## Verification
- Run: `npm run typecheck`
- Run: `npm run probe:charts -- --offline`
