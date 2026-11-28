# apps/desktop/scripts (probes)

## Overview
Standalone verification scripts. Each `probe-<area>.ts` is a `tsx` script that uses Node assertions. There is no test runner. Many probes contact live providers unless they receive `--offline`. The `*-ui` probes drive Electron windows and need a prior build ([CLAUDE.md:Tests (probes)]).

## Interface
- 177 `probe-*.ts` files, for example `probe-charts.ts`, `probe-portfolio.ts`, `probe-stocks.ts`, `probe-mcp.ts`, `probe-cloud-sync.ts`, `probe-maintenance.ts`, `probe-readiness-ui.ts`, `probe-hyperliquid-equities.ts`, and `probe-news-tickertick.ts`. Most are invoked by a root or workspace `probe:*` script in `apps/desktop/package.json`. Some have no npm script (for example `probe-yahoo-worker.ts`) and run directly with `npx tsx scripts/probe-<area>.ts` from `apps/desktop`.
- Families: UI probes (`*-ui`), provider probes (for example `probe-yahoo-worker`, `probe-polymarket`), persistence probes, and maintenance probes.
- Subdirectory: [./fixtures/EGM.md](./fixtures/EGM.md).

## Invariants
- Persistence probes must point `APPDATA` and `LOCALAPPDATA` at temporary directories ([AGENTS.md:Testing Guidelines]).
- Run the offline variant before a live one. Live probes are for provider changes only ([AGENTS.md:Testing Guidelines]).

## Side Effects
- Probes that write data use temporary profiles. Live probes make network calls to providers.
- UI probes start Electron windows and need `npm run build` first.

## Verification
- Run: `npm run probe:charts -- --offline` (deterministic example)
- Run: `npm run probe:maintenance -- --ui` (full pass after a build)
