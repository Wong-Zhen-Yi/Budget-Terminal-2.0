# src/components/finance

## Overview
Personal finance panels: the entries, totals, bills, silos, and goal panels, plus the goal ring.

## Interface
- `EntriesPanel`, `TotalsPanel`, `BillsPanel`, `SilosPanel`, `GoalPanel`, `GoalRing`.

## Invariants
- None verified in this scan.

## Side Effects
- None (renders props or hook data). Edits go through `api/financeQueries.ts` (`useFinanceMutation`).

## Verification
- Run: `npm run typecheck`
