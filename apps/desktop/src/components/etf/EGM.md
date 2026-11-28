# src/components/etf

## Overview
ETF page views: holdings, arbitrage, and the AUM rail.

## Interface
- `HoldingsTab`, `ArbitrageTab`, `AumRail`.

## Invariants
- None verified in this scan.

## Side Effects
- None (renders props or hook data). Data comes through `api/etfQueries.ts`.

## Verification
- Run: `npm run typecheck`
