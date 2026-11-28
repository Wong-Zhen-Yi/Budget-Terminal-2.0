# src/components/options

## Overview
Option chain views: the chain table and the summary table, with a highlight legend.

## Interface
- `OptionChainTable`, `OptionSummaryTable`.
- `HIGHLIGHT_BACKGROUNDS`, `HIGHLIGHT_LEGEND` - row highlight definitions.

## Invariants
- Highlight colours use the locked palette ([AGENTS.md:Locked Colour Scheme]).

## Side Effects
- None (renders props or hook data).

## Verification
- Run: `npm run typecheck`
