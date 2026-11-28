# docs/design-concepts/pltr-round-2

## Overview
Palantir concept renders (`01-terminal.png`, `02-ledger.png`, `03-atlas.png`) and `preview.html`, produced by `render.cjs`.

## Interface
- `render.cjs` - starts Electron as a child process and renders `preview.html` to PNG. It writes each capture to disk with `fs.writeFileSync` ([render.cjs:writeFileSync]).
- `preview.html` - the static preview page.

## Invariants
- The render script runs through the project's Electron install, resolved from the root `package.json` ([render.cjs:createRequire]).

## Side Effects
- Writes PNG files into this folder when run.
- Launches a hidden Electron window (`windowsHide: true`) ([render.cjs:spawn]).

## Verification
- Run: `node docs/design-concepts/pltr-round-2/render.cjs` (manual; not part of the probe set)
