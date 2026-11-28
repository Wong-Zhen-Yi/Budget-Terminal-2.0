# src/components/scorecard

## Overview
Scorecard UI: the controls, the matrix, the analysis panel, and a metric value formatter.

## Interface
- `ScorecardControls`, `ScorecardMatrix`, `ScorecardAnalysis`.
- `scorecardMetricValue` - formats a metric value for display.

## Invariants
- Metric definitions come from `electron/shared/scorecard.ts:SCORECARD_METRICS` ([electron/shared/EGM.md](../../../electron/shared/EGM.md)).

## Side Effects
- None (renders props or hook data).

## Verification
- Run: `npm run typecheck`
- Run: `npm run probe:scorecard-ui` after `npm run build`
