# src/components/tradingvolumes

## Overview
Trading volume views: the volume table, dot plots, the beta dot plot, zoom for plots, and market cap replay.

## Interface
- `VolumeTable`, `DotPlot`, `BetaDotPlot`.
- `useMarketCapReplay`, `usePlotZoom` - hooks.
- `buildTradingVolumesLlmExport` - builds the text export.

## Invariants
- None verified in this scan.

## Side Effects
- None (renders props or hook data).

## Verification
- Run: `npm run typecheck`
- Run: `npm run probe:trading-volumes-ui` after `npm run build`
