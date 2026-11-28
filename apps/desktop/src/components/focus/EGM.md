# src/components/focus

## Overview
Metric cards for Focus pages. Each Focus page keeps its own layout ([AGENTS.md:Independent Focus Page Designs]), so this folder only holds shared metric display.

## Interface
- `FocusCardMetrics` - metric display for a Focus card.

## Invariants
- Shared low-level controls can be reused across Focus pages. Whole-page templates may not ([AGENTS.md:Independent Focus Page Designs]).

## Side Effects
- None (renders props only).

## Verification
- Run: `npm run typecheck`
