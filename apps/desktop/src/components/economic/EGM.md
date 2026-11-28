# src/components/economic

## Overview
Economic data views: an overview table, a grouped table, the headline strip, a series chart, and the yield curve panel.

## Interface
- `EconomicOverviewTable`, `EconomicGroupTable`, `HeadlineStrip`, `SeriesChart`, `YieldCurvePanel`.

## Invariants
- None verified in this scan.

## Side Effects
- None (renders props or hook data). Series come from `api/economicQueries.ts`.

## Verification
- Run: `npm run typecheck`
- Run: `npm run probe:economic` (offline or live)
