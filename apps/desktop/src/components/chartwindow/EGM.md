# src/components/chartwindow

## Overview
The detached chart window component.

## Interface
- `ChartWindow` - the chart shown in a separate window.
- Helpers used by the window: `src/lib/chartWindow.ts:chartWindowSymbol`, `src/lib/chartWindow.ts:isChartWindow` ([src/lib/EGM.md](../../lib/EGM.md)).

## Invariants
- Symbols are normalized with `electron/shared/chartWindow.ts:normalizeChartSymbol`, and the window hash comes from `chartWindowHash` ([electron/shared/EGM.md](../../../electron/shared/EGM.md)).

## Side Effects
- None (renders props or hook data).

## Verification
- Run: `npm run typecheck`
- Run from `apps/desktop` after `npm run build`: `npx tsx scripts/probe-charts-watchlists-ui.ts`
