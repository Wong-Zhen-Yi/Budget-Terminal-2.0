# src/pages/stockDiscovery

## Overview
Support modules for the Stock Discovery page: the scan hook, the display panels, and number formatting.

## Interface
- `useDiscoveryScan.ts:useDiscoveryScan` - hook that runs a discovery scan.
- `DiscoveryPanels.tsx:CompanyPanel`, `DiscoveryPanels.tsx:AnalystPanel`, `DiscoveryPanels.tsx:DiscoveryMetrics`, `DiscoveryPanels.tsx:RangeIndicator`, `DiscoveryPanels.tsx:MetricRows`, `DiscoveryPanels.tsx:TerminalPanel`. These use `PriceChart` from `src/charts` ([src/charts/EGM.md](../../charts/EGM.md)).
- `format.ts:compact`, `format.ts:money`, `format.ts:decimal`, `format.ts:signedPercent`.

## Invariants
- None verified in this scan.

## Side Effects
- `useDiscoveryScan.ts` requests discovery data through `api/` hooks ([src/api/EGM.md](../../api/EGM.md)).

## Verification
- Run: `npm run typecheck`
- Run: `npm run probe:discovery`
