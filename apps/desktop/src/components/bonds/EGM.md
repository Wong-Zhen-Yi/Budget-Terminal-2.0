# src/components/bonds

## Overview
The bond calculator UI. Valuation math is in `electron/shared/bonds.ts`.

## Interface
- `BondCalculator` - bond calculator component ([electron/shared/EGM.md](../../../electron/shared/EGM.md) `bonds.ts:valueFixedRateBond`).

## Invariants
- None verified in this scan.

## Side Effects
- None (renders props or hook data).

## Verification
- Run: `npm run typecheck`
