# src/lib (renderer helpers)

## Overview
Small renderer helpers for formatting, keyboard shortcuts, agent activity and chart references, the chart window, and animated progress.

## Interface
- `format.ts:currency`, `format.ts:quotePrice`, `format.ts:EM_DASH`.
- `shortcuts.ts:shortcutsForPlatform`, `shortcuts.ts:isTextEntry`.
- `agentActivity.ts:topBarAgentActivity`.
- `agentChartHistory.ts:agentHistoryCandles`, `agentChartHistory.ts:agentHistoryStart`.
- `agentChartReferences.ts:agentChartSymbols`.
- `chartWindow.ts:chartWindowSymbol`, `chartWindow.ts:isChartWindow`.
- `useAnimatedProgress.ts:useAnimatedProgress`, `useAnimatedProgress.ts:easeOutCubic`, `useAnimatedProgress.ts:linear`.

## Invariants
- Helpers are renderer-side only. Shared calculations stay in `electron/shared/` ([AGENTS.md:Coding Style]).

## Side Effects
- None beyond React hook state. `useAnimatedProgress` only animates a displayed value.

## Verification
- Run: `npm run typecheck`
