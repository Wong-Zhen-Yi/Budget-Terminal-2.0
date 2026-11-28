# src/components/global

## Overview
Global markets: the market table, the mobile market view, a world map with its geometry loader, and label layout.

## Interface
- `GlobalTable`, `MobileGlobalMarkets`.
- `marketMove`, `intradayRangePercent`, `buildGlobalLlmExport` - calculations and export builder.
- `loadWorldFeatures` - loads world map geometry ([global/worldGeometry.ts]).
- `layoutMobileMapLabels`, `MAP_MARGIN`, `FONT_FAMILY`, `FONTS`.

## Invariants
- None verified in this scan.

## Side Effects
- `worldGeometry.ts` fetches map geometry over the network ([components/global/worldGeometry.ts]).

## Verification
- Run: `npm run typecheck`
