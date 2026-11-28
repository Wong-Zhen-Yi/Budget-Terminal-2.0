# src/components/valuation

## Overview
Valuation UI: assumptions and the fair-value band chart.

## Interface
- `AssumptionsPanel` - assumption inputs.
- `FairValueBandChart` - fair-value band chart.
- `BAND_COLOR` - the band colour.

## Invariants
- Valuation types and assumptions are defined in `electron/shared/valuation.ts` ([electron/shared/EGM.md](../../../electron/shared/EGM.md)).

## Side Effects
- None (renders props or hook data).

## Verification
- Run: `npm run typecheck`
