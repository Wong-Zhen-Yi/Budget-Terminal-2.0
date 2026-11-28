# src/pages/polymarket

## Overview
Views and formatting helpers for the Polymarket page. `PolymarketPage.tsx` imports them from this folder ([src/pages/PolymarketPage.tsx:9]).

## Interface
- `MarketViews.tsx:MarketChart`, `MarketViews.tsx:MarketImage`, `MarketViews.tsx:MarketBook`, `MarketViews.tsx:MarketActivity`.
- `MarketViews.tsx:formatNumber`, `MarketViews.tsx:formatMoney`, `MarketViews.tsx:probability`.

## Invariants
- None verified in this scan.

## Side Effects
- Reads Polymarket data through `api/polymarketQueries.ts` (the parent folder's hooks).

## Verification
- Run: `npm run typecheck`
- Run: `npm run probe:polymarket`
