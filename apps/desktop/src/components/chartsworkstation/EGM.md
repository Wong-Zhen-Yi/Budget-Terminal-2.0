# src/components/chartsworkstation

## Overview
The charts workspace: the main chart workspace, compare view, multi-chart grid, relationship lab, and a cheat sheet.

## Interface
- `MainWorkspace`, `MainChart`, `MiniChart`, `MultiCharts`.
- `CompareWorkspace`, `CompareChart`, `COMPARE_COLORS`.
- `RelationshipLab` - relationship analysis view.
- `BarReadout` - bar value readout.
- `CheatSheet` - keyboard and pattern reference.

## Invariants
- None verified in this scan.

## Side Effects
- None (renders props or hook data). Data comes through `api/chartsQueries.ts`.

## Verification
- Run: `npm run typecheck`
- Run: `npm run probe:charts-ui` after `npm run build`
