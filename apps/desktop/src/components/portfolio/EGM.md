# src/components/portfolio

## Overview
Portfolio UI: the positions table, the summary bar, the metrics, momentum, heatmap, and weight panels, the dip finder, and the add, move, remove, and manage dialogs.

## Interface
- Tables and summaries: `PositionsTable`, `SummaryBar`, `MetricsTab`, `MomentumTab`, `HeatmapTab`, `WeightPanel`, `DayContribution`, `DipFinderPanel`.
- Dialogs: `AddPositionsDialog`, `MovePositionsDialog`, `RemovePositionsDialog`, `ManagePortfoliosDialog`.
- Helpers: `parseTickers`, `buildOptionRows`, `totalOptionsPnl`.

## Invariants
- Portfolio totals are computed by `electron/shared/portfolioMath.ts:buildPortfolioRows` ([electron/shared/EGM.md](../../../electron/shared/EGM.md)).

## Side Effects
- Saves portfolio changes through `api/` hooks to the main-process portfolio store ([electron/services/EGM.md](../../../electron/services/EGM.md) `portfolioStore.ts`).

## Verification
- Run: `npm run typecheck`
- Run: `npm run probe:portfolio`
