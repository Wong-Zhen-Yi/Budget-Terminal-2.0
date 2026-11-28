# src/components/homebuilders

## Overview
Homebuilder views: the capital map and the buyer economics panel.

## Interface
- `BuilderCapitalMap` - capital map component.
- `BuyerEconomics` - buyer economics component. The mortgage helpers are in `electron/shared/homebuyerScenario.ts` ([electron/shared/EGM.md](../../../electron/shared/EGM.md)).

## Invariants
- None verified in this scan.

## Side Effects
- None (renders props or hook data).

## Verification
- Run: `npm run typecheck`
