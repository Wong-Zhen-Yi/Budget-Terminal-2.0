# apps/desktop/scripts/fixtures

## Overview
Recorded provider payloads and TypeScript fixture builders used by the probes. They cover company reports (AMZN, GOOGL, AVGO, MU, NVDA, HIMS, SOFI, VST), homebuilders, semiconductors, scorecards, and plot-zoom samples. Most are HTML or JSON captures; the `.ts` files build sample data.

## Interface
- Recorded inputs: `amzn-2025-q4.html`, `amzn-2026-q1.html`, `amzn-2026-q2.html`, `amzn-reports.json`, `googl-2025-q4.html`, `googl-2026-q3.html`, `googl-reports.json`, `sofi-2026-q2.html`.
- Fixture builders: `amzn.ts`, `avgo.ts`, `googl.ts`, `hims.ts`, `homebuilders.ts`, `mu.ts`, `nvda.ts`, `pltr.ts`, `scorecard.ts`, `semiconductors.ts`, `vst.ts`, `plot-zoom.ts`, `app-zeta-visuals.ts`.
- `mac-relaunch.mjs` - a macOS relaunch helper for probes.

## Invariants
- Fixtures are test data. They must not contain credentials or personal data ([AGENTS.md:User notes]).

## Side Effects
- None. Files are read by probes only.

## Verification
- Run: `npm run probe:amzn` (and the other per-company probes that consume these fixtures)
